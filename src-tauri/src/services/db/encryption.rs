//! Шифрование локального кэша: AES-256-GCM поверх сериализованной базы.
//!
//! Рабочая база живёт в памяти (`Connection::open_in_memory`), а на диске
//! лежит только контейнер `KMPBENC1` = magic + nonce(12) + шифртекст
//! сериализованного образа SQLite (AES-256-GCM, rusqlite-фича `serialize`).
//! Незашифрованные страницы на диск не попадают вообще: запись — это
//! «сериализовать → зашифровать → temp-файл → rename». GCM даёт и
//! конфиденциальность, и целостность: подделка и битый файл не
//! расшифровываются.
//!
//! Ключ (32 байта CSPRNG) хранится в системном хранилище секретов — на
//! Windows это Credential Manager (защищён DPAPI и привязан к учётной
//! записи пользователя) — и никогда не попадает в конфигурацию, логи и
//! IPC. Никаких внешних зависимостей сборки: шифрование и SQLite —
//! pure-Rust/vendored C без OpenSSL, Perl и NASM.
//!
//! Кэш не содержит уникальных данных (избранное и настройки живут в
//! `config.json`, пароли — в keyring, сотрудники — из AD), поэтому
//! нерасшифровываемый файл (потеря ключа, повреждение) или файл, вообще не
//! являющийся контейнером, зануляется и создаётся заново: ближайшая
//! синхронизация восстановит содержимое.

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

/// Длина ключа AES-256, байты.
const KEY_BYTES: usize = 32;

/// Имя записи ключа базы в keyring (сервис общий с секретами LDAP).
const DB_KEY_USER: &str = "db-key";
/// Redundant copy: Windows Credential Manager occasionally drops a single
/// generic credential during upgrades; the backup lets the cache open again.
const DB_KEY_BACKUP_USER: &str = "db-key-backup";

/// Второй, независимый от Credential Manager носитель ключа: файл рядом
/// с базой, зашифрованный DPAPI (привязка к учётной записи Windows).
/// Credential Manager иногда теряет обе generic-записи (переустановка,
/// чистка профиля, политика), и тогда кэш становился недоступен.
#[cfg(windows)]
const KEY_FILE_MAGIC: &[u8; 8] = b"KMPBKEY1";

/// Магический заголовок зашифрованного контейнера (версия формата).
const MAGIC: &[u8; 8] = b"KMPBENC1";

/// Длина nonce AES-GCM.
const NONCE_BYTES: usize = 12;

/// Размер заголовка контейнера: magic + nonce.
const HEADER_BYTES: usize = MAGIC.len() + NONCE_BYTES;

/// Смещения номеров версии формата в заголовке SQLite: байт 18 — версия
/// записи, байт 19 — версия чтения. Значение 2 означает WAL-режим,
/// 1 — rollback-журнал.
const WRITE_VERSION_OFFSET: usize = 18;
const READ_VERSION_OFFSET: usize = 19;
const VERSION_WAL: u8 = 2;
const VERSION_ROLLBACK: u8 = 1;

/// Длина файлового заголовка SQLite; образ короче — не база данных.
const SQLITE_HEADER_LEN: usize = 100;

/// Результат чтения файла кэша.
#[derive(Debug)]
pub enum LoadOutcome {
    /// Контейнер расшифрован — образ базы.
    Bytes(Vec<u8>),
    /// Файла нет — база создаётся с нуля.
    Missing,
    /// Файл есть, но не является нашим контейнером (чужой/битый).
    Foreign,
    /// Контейнер наш, но ключ не подошёл. Preserve the file for recovery
    /// instead of silently destroying a cache that may still be recoverable.
    WrongKey,
}

/// Ключ базы: взять из keyring, затем из DPAPI-файла, при отсутствии —
/// сгенерировать и сохранить во все доступные хранилища. Ошибка keyring не
/// фатальна, если ключ нашёлся в файле: это переживает чистку Credential
/// Manager и перезагрузку.
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

    // Не mint-им новый ключ при временной ошибке keyring и существующей
    // базе: иначе контейнер будет отправлен в карантин. Файл ключа —
    // последний шанс восстановить доступ.
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

/// Путь к DPAPI-файлу ключа рядом с зашифрованным контейнером.
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

/// Сгенерировать ключ CSPRNG.
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
    // Ключ всегда ровно 32 байта, new_from_slice не может ошибиться.
    Aes256Gcm::new_from_slice(key).expect("32-byte AES key")
}

/// Прочитать файл кэша и классифицировать его. Ошибки дешифрования —
/// не ошибка приложения: контейнер помечается `Foreign` и пересоздаётся.
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
        // Наш контейнер, но ключ не подошёл: сохранить файл, не затирать.
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

/// Зашифровать образ базы и атомарно заменить файл кэша.
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

/// Сериализовать открытую базу в образ.
pub fn serialize(conn: &mut Connection) -> Result<Vec<u8>, AppError> {
    let data = conn.serialize(MAIN_DB)?;
    Ok(data.to_vec())
}

/// Восстановить базу из образа: скопировать байты в память SQLite и
/// десериализовать.
///
/// # Safety-контракт
/// Буфер выделяется `sqlite3_malloc` и передаётся в `OwnedData`, который
/// освобождает его через `sqlite3_free` при закрытии базы.
pub fn restore(conn: &mut Connection, bytes: &[u8]) -> Result<(), AppError> {
    let len = i32::try_from(bytes.len())
        .map_err(|_| AppError::Internal("образ кэша слишком большой".into()))?;
    // Десериализуем образ в отдельное соединение, а затем копируем его в
    // целевое через backup API. Прямой sqlite3_deserialize в shared-cache
    // соединение подменяет образ только у этого соединения: reader-пул
    // продолжает видеть пустую базу, и список контактов после перезапуска
    // оказывается пустым при живых count/sync_meta. Backup пишет страницы
    // через обычный механизм SQLite, поэтому данные видны всем соединениям
    // общего кэша.
    let mut source = Connection::open_in_memory()?;
    unsafe {
        let buf = rusqlite::ffi::sqlite3_malloc(len);
        if buf.is_null() {
            return Err(AppError::Internal("не хватило памяти на образ кэша".into()));
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), buf.cast::<u8>(), bytes.len());
        // WAL-образ десериализировать нельзя (см. force_rollback_header) —
        // правим заголовок на копии, уже переданной во владение SQLite.
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

/// Переписать WAL-флаг заголовка образа на rollback-режим.
///
/// Документация SQLite к `sqlite3_deserialize`: образ в WAL-режиме
/// использовать нельзя — любое обращение к базе завершится
/// `SQLITE_CANTOPEN`; вызывающий вправе переписать номера версии формата
/// (байты 18 и 19) на `0x01` до вызова, принудительно переведя образ в
/// rollback-режим. Рабочая база живёт в памяти и сериализуется в
/// rollback-режиме, поэтому правка — защитная нормализация образа перед
/// восстановлением.
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

/// Полный список файлов кэша: контейнер и временный файл записи.
/// Журналов (WAL/SHM) у кэша нет: рабочая база живёт в памяти.
pub fn database_files(path: &Path) -> Vec<PathBuf> {
    vec![path.to_path_buf(), tmp_path(path)]
}

fn tmp_path(path: &Path) -> PathBuf {
    path.with_extension("db.enctmp")
}

/// Занулить и удалить файлы базы и временный контейнер.
pub fn wipe_database_files(path: &Path) -> Result<(), AppError> {
    for file in database_files(path) {
        secure_wipe(&file)?;
    }
    Ok(())
}

/// Перезаписать файл нулями и удалить: на диске не должно оставаться
/// ни шифртекста с утерянным ключом, ни содержимого чужих файлов.
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

        // Бит шифртекста → auth tag не сходится → WrongKey.
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
        // Файл с заголовком SQLite — не наш контейнер: пересоздать.
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
