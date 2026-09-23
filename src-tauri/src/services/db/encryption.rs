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

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use rusqlite::serialize::OwnedData;
use rusqlite::{Connection, DatabaseName};
use tracing::warn;

use crate::error::AppError;
use crate::services::config::store::KEYRING_SERVICE;

/// Длина ключа AES-256, байты.
const KEY_BYTES: usize = 32;

/// Имя записи ключа базы в keyring (сервис общий с секретами LDAP).
const DB_KEY_USER: &str = "db-key";

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
    /// Файл есть, но не является нашим контейнером или не читается
    /// (чужой/битый/не тот ключ) — пересоздать.
    Foreign,
}

/// Ключ базы: взять из keyring, при отсутствии — сгенерировать и
/// сохранить. Ошибка хранилища секретов → `Config` (fail closed: без
/// ключа кэш не открывается и не создаётся).
pub fn database_key() -> Result<[u8; KEY_BYTES], AppError> {
    // Fail closed: без системного хранилища секретов кэш не открывается
    // и не создаётся — ключ негде безопасно хранить.
    let entry = keyring::Entry::new(KEYRING_SERVICE, DB_KEY_USER)
        .map_err(|e| AppError::Config(format!("хранилище секретов недоступно: {e}")))?;
    match entry.get_password() {
        Ok(hex) => match parse_key_hex(&hex) {
            Some(key) => Ok(key),
            // Запись повреждена — перевыпускаем ключ (кэш пересоздаст синк).
            None => {
                warn!(target: "db", "запись ключа базы повреждена — генерирую новый ключ");
                let key = generate_key()?;
                set_key(&entry, &key)?;
                Ok(key)
            }
        },
        Err(keyring::Error::NoEntry) => {
            let key = generate_key()?;
            set_key(&entry, &key)?;
            Ok(key)
        }
        Err(e) => Err(AppError::Config(format!(
            "хранилище секретов недоступно: {e}"
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
        // Битый контейнер или утерянный ключ: пересоздадим, кэш наживёт синк.
        Err(_) => Ok(LoadOutcome::Foreign),
    }
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
pub fn serialize(conn: &Connection) -> Result<Vec<u8>, AppError> {
    let data = conn.serialize(DatabaseName::Main)?;
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
        conn.deserialize(DatabaseName::Main, owned, false)?;
    }
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
            LoadOutcome::Foreign
        ));

        // Бит шифртекста → auth tag не сходится → Foreign.
        let mut raw = fs::read(&path).expect("read");
        let i = raw.len() - 3;
        raw[i] ^= 0xFF;
        fs::write(&path, &raw).expect("write");
        assert!(matches!(
            load(&path, &k).expect("load"),
            LoadOutcome::Foreign
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
}
