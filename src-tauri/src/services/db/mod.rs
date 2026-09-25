//! Локальный кэш контактов: SQLite + полнотекстовый поиск (FTS5).
//!
//! База — единственный источник данных для выдачи: поиск никогда не ходит
//! в AD напрямую (это быстро и работает офлайн), а синхронизация с каталогом
//! выполняется отдельным фоновым процессом [`crate::services::sync`].
//!
//! # Схема (нормализована до 3НФ)
//!
//! Повторяющиеся текстовые значения хранятся **по одному разу** в
//! справочниках, а `users` ссылается на них внешними ключами:
//!
//! ```text
//! sources ──┬──< users >──┬── orgs         организация (AD company)
//!           │             ├── departments  подразделение (AD department)
//! sync_meta ┘             └── locations    кабинет/адрес (AD physicalDeliveryOfficeName)
//!
//! users_fts — поисковый индекс (намеренно денормализован, пересоздаётся при синхронизации)
//! ```
//!
//! * `sources` — источники записей: подключения к AD из настроек приложения
//!   (`kind = 'ad'`) и внешний телефонный файл (`kind = 'external'`,
//!   [`crate::services::external`]). Кэш сотрудников принадлежит источнику
//!   и полностью заменяется при его повторной синхронизации
//!   (`ON DELETE CASCADE`).
//! * `orgs` — одна строка на группу вариантов написания: `name_key`
//!   (нормализованный ключ — SQLite `lower()` не знает кириллицу, поэтому
//!   ключ вычисляется в Rust), `name` — отображаемый вариант.
//! * `departments`, `locations` — справочники с уникальными именами;
//!   значения, на которые больше никто не ссылается, удаляются при
//!   синхронизации вместе с исчезнувшими сотрудниками.
//! * `users` — сотрудник: идентификаторы (GUID, SAM, ФИО), контакты
//!   (почта, телефоны, `pager` — TrueConf ID), должность/руководитель,
//!   ссылки на справочники и мета синхронизации (`usn_changed`, `updated_at`).
//!
//! Целостность обеспечивают ограничения схемы, а не код запросов:
//! `PRIMARY KEY`, `UNIQUE`, `NOT NULL` и `FOREIGN KEY` (`PRAGMA foreign_keys=ON`).
//! Версия схемы хранится в `PRAGMA user_version`; несовпадение с актуальной
//! пересоздаёт кэш ([`schema::ensure_schema`]) — содержимое восстановит
//! синхронизация.
//!
//! # Шифрование
//!
//! Рабочая база живёт в памяти, а на диске — только контейнер `KMPBENC1`
//! (AES-256-GCM поверх сериализованного образа SQLite): без ключа файл
//! нечитаем даже при утечке диска, а подделку отсекает auth-тег GCM. Ключ
//! хранится в системном хранилище секретов (Windows Credential Manager) и
//! на диск не попадает — подробности в [`encryption`]. Файл, не являющийся
//! контейнером (чужой, повреждённый, утерянный ключ), зануляется и
//! пересоздаётся: данные восстановит синхронизация. Каждое изменение кэша
//! сразу пересохраняет контейнер ([`Db::flush`]).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use tracing::warn;

use crate::error::AppError;

mod dedup;
mod encryption;
mod lookups;
mod model;
mod read;
mod schema;
mod write;

#[cfg(test)]
mod tests;

pub use dedup::DuplicatesPreview;
pub use model::{Employee, SearchPage, SearchParams, UserRecord};

pub struct Db {
    conn: Arc<Mutex<Connection>>,
    /// Путь зашифрованного контейнера; `None` у in-memory баз (тесты) —
    /// там flush() не пишет на диск.
    path: Option<PathBuf>,
    /// Ключ AES-256 контейнера (в тестах — нулевой, не используется).
    key: [u8; 32],
}

impl Clone for Db {
    fn clone(&self) -> Self {
        Self {
            conn: Arc::clone(&self.conn),
            path: self.path.clone(),
            key: self.key,
        }
    }
}

pub fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
impl Db {
    pub fn open(db_path: &Path) -> Result<Self, AppError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let key = encryption::database_key()?;
        let image: Option<Vec<u8>> = match encryption::load(db_path, &key)? {
            encryption::LoadOutcome::Bytes(bytes) => Some(bytes),
            encryption::LoadOutcome::Missing => None,
            encryption::LoadOutcome::Foreign => {
                warn!(target: "db", "файл кэша не расшифровывается — пересоздаю; данные восстановит синхронизация");
                encryption::wipe_database_files(db_path)?;
                None
            }
        };
        let mut conn = Connection::open_in_memory()?;
        Self::apply_pragmas(&conn)?;
        if let Some(bytes) = image.as_deref() {
            encryption::restore(&mut conn, bytes)?;
        }
        schema::ensure_schema(&conn)?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            path: Some(db_path.to_path_buf()),
            key,
        };
        // Фиксируем контейнер сразу: свежая база или образ после deserialize —
        // на диске всегда актуальный зашифрованный файл.
        db.flush()?;
        Ok(db)
    }

    /// In-memory база — для unit-тестов (файла на диске нет, flush() no-op).
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()?;
        Self::apply_pragmas(&conn)?;
        schema::ensure_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            path: None,
            key: [0u8; 32],
        })
    }

    fn apply_pragmas(conn: &Connection) -> Result<(), AppError> {
        // База живёт в памяти: WAL/synchronous не применяются.
        // Внешние ключи в SQLite по умолчанию выключены: без этой прагмы
        // REFERENCES в схеме были бы просто документацией.
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(())
    }

    /// Сериализовать базу, зашифровать и атомарно записать контейнер.
    /// Вызывается после каждого изменения кэша; для in-memory баз (тесты)
    /// это no-op.
    fn flush(&self) -> Result<(), AppError> {
        let Some(path) = self.path.as_deref() else {
            return Ok(());
        };
        let conn = self.lock();
        let bytes = encryption::serialize(&conn)?;
        drop(conn);
        encryption::save(path, &self.key, &bytes)
    }
    fn lock(&self) -> MutexGuard<'_, Connection> {
        // Отравленный мьютекс (паника в другой команде) не должен ронять
        // всё приложение — соединение остаётся валидным.
        self.conn.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Доступ к соединению для тестов (например, подкрутка sync_meta).
    #[cfg(test)]
    pub fn conn_for_tests(&self) -> &Arc<Mutex<Connection>> {
        &self.conn
    }
}
