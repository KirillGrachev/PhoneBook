//! Local cache encryption: AES-256-GCM over the serialized database.
//!
//! The working database lives in memory (`Connection::open_in_memory`), while on disk
//! there is only the `KMPBENC1` container = magic + nonce(12) + ciphertext
//! (a serialized SQLite image; AES-256-GCM, rusqlite `serialize` feature).
//! Unencrypted pages never reach disk: writing is
//! "serialize -> encrypt -> temp file -> rename". GCM provides
//! both confidentiality and integrity: tampering and a broken file are not
//! decrypted.
//!
//! The key (32 bytes from CSPRNG) is stored in the system secret store - on
//! Windows this is Credential Manager (protected by DPAPI and tied to the
//! Windows user account) - and never ends up in configuration, logs, or
//! IPC. No external build dependencies: encryption and SQLite are
//! pure-Rust/vendored C without OpenSSL, Perl, and NASM.
//!
//! The cache contains no unique data (starred contacts and settings live in
//! `config.json`, passwords in the keyring, employees from AD), therefore an
//! undecryptable file (lost key, corruption) or a file that is not
//! a container is zeroed and recreated: the nearest
//! sync will restore the contents.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use rusqlite::backup::Backup;
use rusqlite::serialize::OwnedData;
use rusqlite::{Connection, MAIN_DB};
use tracing::warn;

#[cfg(windows)]
use windows::Win32::Foundation::{LocalFree, HLOCAL};
#[cfg(windows)]
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

use crate::error::AppError;
use crate::services::config::store::KEYRING_SERVICE;

/// AES-256 key length, bytes.
const KEY_BYTES: usize = 32;

/// Database key entry name in the keyring (the service is shared with LDAP secrets).
const DB_KEY_USER: &str = "db-key";
/// Redundant copy: Windows Credential Manager occasionally drops a single
/// generic credential during upgrades; the backup lets the cache open again.
const DB_KEY_BACKUP_USER: &str = "db-key-backup";

/// A second key carrier independent of Credential Manager: a file next
/// with the database, encrypted by DPAPI (bound to the Windows account).
/// Credential Manager sometimes loses both generic entries (reinstallation,
/// profile cleanup, policy), and then the cache became inaccessible.
#[cfg(windows)]
const KEY_FILE_MAGIC: &[u8; 8] = b"KMPBKEY1";

/// Magic header of the encrypted container (format version).
const MAGIC: &[u8; 8] = b"KMPBENC1";

/// AES-GCM nonce length.
const NONCE_BYTES: usize = 12;

/// Container header size: magic + nonce.
const HEADER_BYTES: usize = MAGIC.len() + NONCE_BYTES;

/// Offsets of the format version numbers in the SQLite header: byte 18 - version
/// record; byte 19 - read version. The value 2 means WAL mode,
/// 1 - rollback journal.
const WRITE_VERSION_OFFSET: usize = 18;
const READ_VERSION_OFFSET: usize = 19;
const VERSION_WAL: u8 = 2;
const VERSION_ROLLBACK: u8 = 1;

/// SQLite file header length; a shorter image is not a database.
const SQLITE_HEADER_LEN: usize = 100;

/// Cache file read result.
#[derive(Debug)]
pub enum LoadOutcome {
    /// The container is decrypted - a database image.
    Bytes(Vec<u8>),
    /// No file - the database is created from scratch.
    Missing,
    /// The file exists but is not our container (foreign/broken).
    Foreign,
    /// The container is ours, but the key did not match. Preserve the file for recovery
    /// instead of silently destroying a cache that may still be recoverable.
    WrongKey,
}

/// Database key: take from the keyring, then from the DPAPI file; if absent -
/// generate and save it to all available stores. A keyring error is not
/// fatal if the key was found in the file: this survives Credential
/// Manager cleanup and reload.
pub fn database_key(db_path: &Path) -> Result<[u8; KEY_BYTES], AppError> {
    let key_path = key_file_path(db_path);
    let mut key_store_error = false;

    let primary = keyring::Entry::new(KEYRING_SERVICE, DB_KEY_USER)
        .map_err(|error| {
            key_store_error = true;
            warn!(target: "db", %error, "хранилище секретов недоступно — пробую файл ключа");
        })
        .ok();
    let backup = keyring::Entry::new(KEYRING_SERVICE, DB_KEY_BACKUP_USER).ok();

    let primary_key = primary.as_ref().and_then(|entry| match read_key(entry) {
        Ok(key) => key,
        Err(error) => {
            warn!(target: "db", %error, "ключ базы в keyring недоступен — пробую файл ключа");
            key_store_error = true;
            None
        }
    });
    let backup_key = backup.as_ref().and_then(|entry| match read_key(entry) {
        Ok(key) => key,
        Err(error) => {
            warn!(target: "db", %error, "резервный ключ базы недоступен");
            key_store_error = true;
            None
        }
    });
    let file_key = match read_key_file(&key_path) {
        Ok(key) => key,
        Err(error) => {
            warn!(target: "db", %error, "файл ключа базы недоступен");
            None
        }
    };

    // We do not mint a new key on a temporary keyring error and an existing
    // database: otherwise the container would be quarantined. The key file -
    // the last chance to restore access.
    if primary_key.is_none()
        && backup_key.is_none()
        && file_key.is_none()
        && key_store_error
        && db_path.exists()
    {
        return Err(AppError::Config(
            "хранилище ключа базы временно недоступно; перезапустите приложение".into(),
        ));
    }

    let generated = primary_key.is_none() && backup_key.is_none() && file_key.is_none();
    let key = primary_key
        .or(backup_key)
        .or(file_key)
        .unwrap_or(generate_key()?);
    let mut persisted = !generated;

    if primary_key != Some(key) {
        if let Some(entry) = primary.as_ref() {
            match set_key(entry, &key) {
                Ok(()) => persisted = true,
                Err(error) => {
                    warn!(target: "db", %error, "не удалось сохранить основной ключ базы")
                }
            }
        }
    }
    if backup_key != Some(key) {
        if let Some(entry) = backup.as_ref() {
            match set_key(entry, &key) {
                Ok(()) => persisted = true,
                Err(error) => {
                    warn!(target: "db", %error, "не удалось сохранить резервный ключ базы")
                }
            }
        }
    }
    if file_key != Some(key) {
        match write_key_file(&key_path, &key) {
            Ok(()) => persisted = true,
            Err(error) => warn!(target: "db", %error, "не удалось сохранить файл ключа базы"),
        }
    }

    if generated && !persisted {
        return Err(AppError::Config(
            "не удалось сохранить ключ базы ни в keyring, ни в файл".into(),
        ));
    }

    Ok(key)
}

/// Path to the DPAPI key file next to the encrypted container.
fn key_file_path(db_path: &Path) -> PathBuf {
    db_path.with_extension("key")
}

#[cfg(windows)]
fn read_key_file(path: &Path) -> Result<Option<[u8; KEY_BYTES]>, AppError> {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if data.len() < KEY_FILE_MAGIC.len() || &data[..KEY_FILE_MAGIC.len()] != KEY_FILE_MAGIC {
        warn!(target: "db", "файл ключа базы повреждён — игнорирую");
        return Ok(None);
    }
    Ok(Some(unprotect_key(&data[KEY_FILE_MAGIC.len()..])?))
}

#[cfg(not(windows))]
fn read_key_file(_path: &Path) -> Result<Option<[u8; KEY_BYTES]>, AppError> {
    Ok(None)
}

#[cfg(windows)]
fn write_key_file(path: &Path, key: &[u8; KEY_BYTES]) -> Result<(), AppError> {
    let protected = protect_key(key)?;
    let mut data = Vec::with_capacity(KEY_FILE_MAGIC.len() + protected.len());
    data.extend_from_slice(KEY_FILE_MAGIC);
    data.extend_from_slice(&protected);

    let temp_path = path.with_extension("key.tmp");
    fs::write(&temp_path, &data)?;
    let _ = fs::remove_file(path);
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error.into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn write_key_file(_path: &Path, _key: &[u8; KEY_BYTES]) -> Result<(), AppError> {
    Ok(())
}

#[cfg(windows)]
fn protect_key(key: &[u8; KEY_BYTES]) -> Result<Vec<u8>, AppError> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: KEY_BYTES as u32,
        pbData: key.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            windows::core::w!("KMAruda PhoneBook database key"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| AppError::Config(format!("DPAPI: {error}")))?;

        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(bytes)
    }
}

#[cfg(windows)]
fn unprotect_key(blob: &[u8]) -> Result<[u8; KEY_BYTES], AppError> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: blob.len() as u32,
        pbData: blob.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| AppError::Config(format!("DPAPI: {error}")))?;

        if output.cbData as usize != KEY_BYTES {
            let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
            return Err(AppError::Config("неверная длина ключа базы".into()));
        }

        let mut key = [0u8; KEY_BYTES];
        std::ptr::copy_nonoverlapping(output.pbData, key.as_mut_ptr(), KEY_BYTES);
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(key)
    }
}

fn read_key(entry: &keyring::Entry) -> Result<Option<[u8; KEY_BYTES]>, AppError> {
    match entry.get_password() {
        Ok(hex) => match parse_key_hex(&hex) {
            Some(key) => Ok(Some(key)),
            None => {
                warn!(target: "db", "запись ключа базы повреждена — пробую резервную");
                Ok(None)
            }
        },
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(AppError::Config(format!(
            "хранилище секретов недоступно: {error}"
        ))),
    }
}

fn set_key(entry: &keyring::Entry, key: &[u8; KEY_BYTES]) -> Result<(), AppError> {
    entry
        .set_password(&key_hex(key))
        .map_err(|e| AppError::Config(format!("не удалось сохранить ключ базы: {e}")))
}

/// Generate a CSPRNG key.
pub fn generate_key() -> Result<[u8; KEY_BYTES], AppError> {
    let mut key = [0u8; KEY_BYTES];
    fill_random(&mut key)?;
    Ok(key)
}

fn key_hex(key: &[u8; KEY_BYTES]) -> String {
    key.iter().map(|b| format!("{b:02x}")).collect()
}

fn parse_key_hex(hex: &str) -> Option<[u8; KEY_BYTES]> {
    let trimmed = hex.trim();
    if trimmed.len() != KEY_BYTES * 2 || !trimmed.is_char_boundary(0) {
        return None;
    }
    let mut key = [0u8; KEY_BYTES];
    for (i, chunk) in trimmed.as_bytes().chunks(2).enumerate() {
        let byte = u8::from_str_radix(std::str::from_utf8(chunk).ok()?, 16).ok()?;
        key[i] = byte;
    }
    Some(key)
}

fn fill_random(buf: &mut [u8]) -> Result<(), AppError> {
    getrandom::getrandom(buf).map_err(|e| AppError::Internal(format!("CSPRNG: {e}")))
}

fn cipher(key: &[u8; KEY_BYTES]) -> Aes256Gcm {
    // The key is always exactly 32 bytes, new_from_slice cannot fail.
    Aes256Gcm::new_from_slice(key).expect("32-byte AES key")
}

/// Read the cache file and classify it. Decryption errors -
/// not an application error: the container is marked `Foreign` and recreated.
pub fn load(path: &Path, key: &[u8; KEY_BYTES]) -> Result<LoadOutcome, AppError> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(LoadOutcome::Missing),
        Err(e) => return Err(e.into()),
    };
    if raw.len() < HEADER_BYTES || !raw.starts_with(MAGIC) {
        return Ok(LoadOutcome::Foreign);
    }
    let (nonce, ciphertext) = raw.split_at(HEADER_BYTES);
    match cipher(key).decrypt(Nonce::from_slice(&nonce[MAGIC.len()..]), ciphertext) {
        Ok(bytes) => Ok(LoadOutcome::Bytes(bytes)),
        // Our container, but the key did not fit: keep the file, do not overwrite.
        Err(_) => Ok(LoadOutcome::WrongKey),
    }
}

/// Keep an encrypted container whose key did not match instead of deleting it.
/// The file is useless without the key, but a later recovery can still try an
/// older key copy; the app starts with a fresh cache in the meantime.
pub fn quarantine_database_file(path: &Path) -> Result<Option<PathBuf>, AppError> {
    if !path.exists() {
        return Ok(None);
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let target = path.with_extension(format!("db.unreadable-{stamp}"));
    fs::rename(path, &target)?;
    Ok(Some(target))
}

/// Encrypt the database image and atomically replace the cache file.
pub fn save(path: &Path, key: &[u8; KEY_BYTES], plaintext: &[u8]) -> Result<(), AppError> {
    let mut nonce = [0u8; NONCE_BYTES];
    fill_random(&mut nonce)?;
    let ciphertext = cipher(key)
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|e| AppError::Internal(format!("не удалось зашифровать кэш: {e}")))?;
    let tmp = tmp_path(path);
    let mut file = fs::File::create(&tmp)?;
    file.write_all(MAGIC)?;
    file.write_all(&nonce)?;
    file.write_all(&ciphertext)?;
    file.sync_all()?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Serialize the open database into an image.
pub fn serialize(conn: &mut Connection) -> Result<Vec<u8>, AppError> {
    let data = conn.serialize(MAIN_DB)?;
    Ok(data.to_vec())
}

/// Restore the database from an image: copy the bytes into SQLite memory and
/// deserialize.
///
/// # Safety contract
/// The buffer is allocated by `sqlite3_malloc` and passed to `OwnedData`, which
/// frees it via `sqlite3_free` when the database is closed.
pub fn restore(conn: &mut Connection, bytes: &[u8]) -> Result<(), AppError> {
    let len = i32::try_from(bytes.len())
        .map_err(|_| AppError::Internal("образ кэша слишком большой".into()))?;
    // We deserialize the image into a separate connection, then copy it into the
    // target via the backup API. Direct sqlite3_deserialize on a shared-cache
    // connection replaces the image only for that connection: the reader pool
    // continues to see an empty database, and the contact list after restart
    // turns out empty while count/sync_meta are live. Backup writes pages
    // through the normal SQLite mechanism, so the data is visible to all connections
    // in the shared cache.
    let mut source = Connection::open_in_memory()?;
    unsafe {
        let buf = rusqlite::ffi::sqlite3_malloc(len);
        if buf.is_null() {
            return Err(AppError::Internal("не хватило памяти на образ кэша".into()));
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), buf.cast::<u8>(), bytes.len());
        // A WAL image cannot be deserialized (see force_rollback_header) —
        // edit the header on the copy already passed into SQLite ownership.
        force_rollback_header(std::slice::from_raw_parts_mut(
            buf.cast::<u8>(),
            bytes.len(),
        ));
        let owned = match std::ptr::NonNull::new(buf.cast::<u8>()) {
            Some(ptr) => OwnedData::from_raw_nonnull(ptr, bytes.len()),
            None => return Err(AppError::Internal("пустой образ кэша".into())),
        };
        source.deserialize(MAIN_DB, owned, false)?;
    }

    let backup = Backup::new(&source, conn)?;
    backup.run_to_completion(1024, Duration::ZERO, None)?;
    Ok(())
}

/// Rewrite the image header's WAL flag to rollback mode.
///
/// SQLite documentation for `sqlite3_deserialize`: an image in WAL mode
/// cannot be used - any database access will end with
/// `SQLITE_CANTOPEN`; the caller may rewrite the format version numbers
/// (bytes 18 and 19) to `0x01` before the call, forcibly putting the image into
/// rollback mode. The working database lives in memory and is serialized into
/// rollback mode, so the edit is a defensive normalization of the image before
/// recovery.
fn force_rollback_header(image: &mut [u8]) {
    if image.len() < SQLITE_HEADER_LEN {
        return;
    }
    if image[WRITE_VERSION_OFFSET] == VERSION_WAL && image[READ_VERSION_OFFSET] == VERSION_WAL {
        image[WRITE_VERSION_OFFSET] = VERSION_ROLLBACK;
        image[READ_VERSION_OFFSET] = VERSION_ROLLBACK;
        warn!(target: "db", "образ кэша в WAL-формате — перевожу в rollback-режим для восстановления");
    }
}

/// Full list of cache files: the container and the temporary write file.
/// The cache has no journals (WAL/SHM): the working database lives in memory.
pub fn database_files(path: &Path) -> Vec<PathBuf> {
    vec![path.to_path_buf(), tmp_path(path)]
}

fn tmp_path(path: &Path) -> PathBuf {
    path.with_extension("db.enctmp")
}

/// Zero out and delete the database files and the temporary container.
pub fn wipe_database_files(path: &Path) -> Result<(), AppError> {
    for file in database_files(path) {
        secure_wipe(&file)?;
    }
    Ok(())
}

/// Overwrite the file with zeros and delete it: nothing must remain on disk
/// neither ciphertext with a lost key nor the contents of foreign files.
pub fn secure_wipe(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        return Ok(());
    }
    let len = fs::metadata(path)?.len();
    let mut file = fs::File::create(path)?;
    std::io::copy(&mut std::io::repeat(0u8).take(len), &mut file)?;
    file.sync_all()?;
    drop(file);
    fs::remove_file(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> [u8; KEY_BYTES] {
        [byte; KEY_BYTES]
    }

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("kmpb-enc-test-{}", std::process::id()))
    }

    fn db_path(tag: &str) -> PathBuf {
        let dir = temp_dir();
        fs::create_dir_all(&dir).expect("temp dir");
        dir.join(format!("{tag}.db"))
    }

    #[test]
    fn generated_keys_are_unique_and_hex_roundtrip() {
        let a = generate_key().expect("key a");
        let b = generate_key().expect("key b");
        assert_ne!(a, b);
        let hex = key_hex(&a);
        assert_eq!(hex.len(), 64);
        assert_eq!(parse_key_hex(&hex), Some(a));
        assert_eq!(parse_key_hex("deadbeef"), None);
        assert_eq!(parse_key_hex(&"z".repeat(64)), None);
    }

    #[test]
    fn save_then_load_roundtrips() {
        let path = db_path("roundtrip");
        let k = key(7);
        let payload = b"sqlite-image-bytes";
        save(&path, &k, payload).expect("save");
        let raw = fs::read(&path).expect("read");
        assert!(raw.starts_with(MAGIC));
        assert_eq!(raw.len(), HEADER_BYTES + payload.len() + 16); // + GCM tag
        match load(&path, &k).expect("load") {
            LoadOutcome::Bytes(b) => assert_eq!(b, payload),
            other => panic!("unexpected outcome: {other:?}"),
        }
        wipe_database_files(&path).expect("wipe");
        assert!(!path.exists());
    }

    #[test]
    fn wrong_key_tampering_and_foreign_files_are_rejected() {
        let path = db_path("reject");
        let k = key(9);
        save(&path, &k, b"payload").expect("save");
        assert!(matches!(
            load(&path, &key(10)).expect("load"),
            LoadOutcome::WrongKey
        ));

        // A flipped ciphertext bit → the auth tag does not match → WrongKey.
        let mut raw = fs::read(&path).expect("read");
        let i = raw.len() - 3;
        raw[i] ^= 0xFF;
        fs::write(&path, &raw).expect("write");
        assert!(matches!(
            load(&path, &k).expect("load"),
            LoadOutcome::WrongKey
        ));

        fs::write(&path, b"garbage-not-a-db").expect("write");
        assert!(matches!(
            load(&path, &k).expect("load"),
            LoadOutcome::Foreign
        ));
        wipe_database_files(&path).expect("wipe");
    }

    #[test]
    fn missing_file_is_missing() {
        let path = db_path("missing");
        let _ = fs::remove_file(&path);
        assert!(matches!(
            load(&path, &key(1)).expect("load"),
            LoadOutcome::Missing
        ));
    }

    #[test]
    fn plaintext_sqlite_file_is_foreign() {
        let path = db_path("plaintext");
        let k = key(3);
        // A file with a SQLite header is not our container: recreate it.
        fs::write(&path, b"SQLite format 3\0....").expect("write");
        assert!(matches!(
            load(&path, &k).expect("load"),
            LoadOutcome::Foreign
        ));
        wipe_database_files(&path).expect("wipe");
    }

    #[test]
    fn restore_of_empty_image_does_not_panic() {
        let mut conn = Connection::open_in_memory().expect("conn");
        let _ = restore(&mut conn, &[]);
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_key_file_roundtrip() {
        let path = db_path("dpapi-key").with_extension("key");
        let expected = key(7);
        write_key_file(&path, &expected).expect("write key file");
        assert_eq!(read_key_file(&path).expect("read key file"), Some(expected));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("key.tmp"));
    }
}
