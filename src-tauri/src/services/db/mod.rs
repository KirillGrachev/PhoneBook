//! Local contact cache: SQLite + full-text search (FTS5).
//!
//! The database is the only data source for results: search never goes
//! directly to AD (this is fast and works offline), while catalog sync
//! is performed by a separate background process [`crate::services::sync`].
//!
//! # Schema (normalized to 3NF)
//!
//! Repeated text values are stored **exactly once** in
//! lookups, and `users` references them via foreign keys:
//!
//! ```text
//! sources ──┬──< users >──┬── orgs         organization (AD company)
//! │             ├── departments  department (AD department)
//! sync_meta ┘             └── locations    office/address (AD physicalDeliveryOfficeName)
//!
//! users_fts - search index (intentionally denormalized, rebuilt during sync)
//! ```
//!
//! * `sources` - record sources: AD connections from application settings
//! (`kind = 'ad'`) and the external phone file (`kind = 'external'`,
//! [`crate::services::external`]). The employee cache belongs to the source
//! and is fully replaced when it is synchronized again
//! (`ON DELETE CASCADE`).
//! * `orgs` - one row per group of spelling variants: `name_key`
//! (normalized key - SQLite `lower()` does not know Cyrillic, therefore
//! the key is computed in Rust), `name` is the display variant.
//! * `departments`, `locations` - lookups with unique names;
//! values no longer referenced by anyone are removed during
//! sync together with disappeared employees.
//! * `users` - employee: identifiers (GUID, SAM, full name), contacts
//! (email, phone numbers, `pager` - TrueConf ID), job title/supervisor,
//! lookup references and sync metadata (`usn_changed`, `updated_at`).
//!
//! Integrity is enforced by schema constraints, not query code:
//! `PRIMARY KEY`, `UNIQUE`, `NOT NULL`, and `FOREIGN KEY` (`PRAGMA foreign_keys=ON`).
//! The schema version is stored in `PRAGMA user_version`; a mismatch with the current version
//! recreates the cache ([`schema::ensure_schema`]); sync will restore the contents.
//!
//!
//! # Encryption
//!
//! The working database lives in memory, while on disk there is only the `KMPBENC1` container
//! (AES-256-GCM over a serialized SQLite image): without the key the file
//! is unreadable even if the disk leaks, and the GCM auth tag rejects tampering. The key
//! is stored in the system secret store (Windows Credential Manager) and
//! never reaches disk - details in [`encryption`]. A file that is not
//! a container (foreign, corrupted, lost key), it is zeroed and
//! recreated: sync will restore the data. Every cache change
//! immediately resaves the container ([`Db::flush`]).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OpenFlags};
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
pub use model::{AdDuplicateRecord, Employee, SearchPage, SearchParams, UserRecord};

/// Small cache of ready pages: repeated/backward input must not every
/// time serialize on the shared `Mutex<Connection>`.
const SEARCH_CACHE_LIMIT: usize = 64;

#[derive(Default)]
struct SearchCache {
    entries: VecDeque<((u64, SearchParams), SearchPage)>,
}

impl SearchCache {
    fn get(&self, key: &(u64, SearchParams)) -> Option<SearchPage> {
        self.entries
            .iter()
            .find(|(entry, _)| entry == key)
            .map(|(_, page)| page.clone())
    }

    fn put(&mut self, key: (u64, SearchParams), page: SearchPage) {
        if self.entries.len() >= SEARCH_CACHE_LIMIT {
            self.entries.pop_front();
        }
        self.entries.push_back((key, page));
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}

pub struct Db {
    conn: Arc<Mutex<Connection>>,
    /// Encrypted container path; `None` for in-memory databases (tests) -
    /// there flush() does not write to disk.
    path: Option<PathBuf>,
    /// AES-256 container key (zero in tests, unused).
    key: [u8; 32],
    search_generation: Arc<AtomicU64>,
    search_cache: Arc<Mutex<SearchCache>>,
    /// Read-only connections to the same shared-cache in-memory DB. Empty in
    /// tests; production uses 4 so cold searches do not wait on
    /// the single `Mutex<Connection>`.
    readers: Arc<Mutex<Vec<Connection>>>,
}

impl Clone for Db {
    fn clone(&self) -> Self {
        Self {
            conn: Arc::clone(&self.conn),
            path: self.path.clone(),
            key: self.key,
            search_generation: Arc::clone(&self.search_generation),
            search_cache: Arc::clone(&self.search_cache),
            readers: Arc::clone(&self.readers),
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
        let key = encryption::database_key(db_path)?;
        let image: Option<Vec<u8>> = match encryption::load(db_path, &key)? {
            encryption::LoadOutcome::Bytes(bytes) => Some(bytes),
            encryption::LoadOutcome::Missing => None,
            encryption::LoadOutcome::Foreign => {
                warn!(target: "db", "файл кэша не является нашим контейнером — пересоздаю");
                encryption::wipe_database_files(db_path)?;
                None
            }
            encryption::LoadOutcome::WrongKey => {
                if let Some(quarantined) = encryption::quarantine_database_file(db_path)? {
                    warn!(
                        target: "db",
                        path = %quarantined.display(),
                        "ключ кэша не подошёл — контейнер сохранён, создаю новый кэш"
                    );
                }
                None
            }
        };
        // A shared-cache in-memory DB lets read-only connections see the same
        // cache without copying it. The name is unique within the process.
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let db_uri = format!(
            "file:phonebook-{}-{nanos}?mode=memory&cache=shared",
            std::process::id()
        );
        let flags = OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE;
        let mut conn = Connection::open_with_flags(&db_uri, flags)?;
        Self::apply_pragmas(&conn)?;
        if let Some(bytes) = image.as_deref() {
            encryption::restore(&mut conn, bytes)?;
        }
        schema::ensure_schema(&conn)?;

        let mut readers = Vec::new();
        for _ in 0..4 {
            match Connection::open_with_flags(&db_uri, flags) {
                Ok(reader) => {
                    Self::apply_pragmas(&reader)?;
                    // The DDL might not reach the shared-cache reader (e.g.,
                    // after deserializing the image); the schema must be visible.
                    schema::ensure_schema(&reader)?;
                    readers.push(reader);
                }
                Err(error) => warn!(target: "db", %error, "read-соединение не открылось"),
            }
        }

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            path: Some(db_path.to_path_buf()),
            key,
            search_generation: Arc::new(AtomicU64::new(0)),
            search_cache: Arc::new(Mutex::new(SearchCache::default())),
            readers: Arc::new(Mutex::new(readers)),
        };
        // Pin the container immediately: a fresh database or an image after deserialize -
        // an up-to-date encrypted file is always on disk.
        db.flush()?;
        Ok(db)
    }

    /// In-memory database - for unit tests (no file on disk, flush() is a no-op).
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()?;
        Self::apply_pragmas(&conn)?;
        schema::ensure_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            path: None,
            key: [0u8; 32],
            search_generation: Arc::new(AtomicU64::new(0)),
            search_cache: Arc::new(Mutex::new(SearchCache::default())),
            readers: Arc::new(Mutex::new(Vec::new())),
        })
    }

    /// Test copy of the production path: shared-cache in-memory + read pool.
    #[cfg(test)]
    pub fn open_shared_in_memory() -> Result<Self, AppError> {
        let uri = format!(
            "file:phonebook-test-{}-{}?mode=memory&cache=shared",
            std::process::id(),
            unix_now()
        );
        let flags = OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE;
        let conn = Connection::open_with_flags(&uri, flags)?;
        Self::apply_pragmas(&conn)?;
        schema::ensure_schema(&conn)?;
        let mut readers = Vec::new();
        for _ in 0..2 {
            let reader = Connection::open_with_flags(&uri, flags)?;
            Self::apply_pragmas(&reader)?;
            schema::ensure_schema(&reader)?;
            readers.push(reader);
        }
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            path: None,
            key: [0u8; 32],
            search_generation: Arc::new(AtomicU64::new(0)),
            search_cache: Arc::new(Mutex::new(SearchCache::default())),
            readers: Arc::new(Mutex::new(readers)),
        })
    }

    fn apply_pragmas(conn: &Connection) -> Result<(), AppError> {
        // The database lives in memory: WAL/synchronous do not apply.
        // Foreign keys in SQLite are off by default: without this pragma
        // REFERENCES in the schema would be just documentation.
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // Shared-cache readers/writer may wait on each other; we do not hand out
        // immediate SQLITE_BUSY, but wait up to 5 seconds.
        conn.busy_timeout(Duration::from_secs(5))?;
        Ok(())
    }

    /// Serialize the database, encrypt it, and atomically write the container.
    /// Called after every cache change; for in-memory databases (tests)
    /// this is a no-op.
    fn flush(&self) -> Result<(), AppError> {
        let Some(path) = self.path.as_deref() else {
            return Ok(());
        };
        let mut conn = self.lock();
        let bytes = encryption::serialize(&mut conn)?;
        drop(conn);
        encryption::save(path, &self.key, &bytes)
    }
    fn lock(&self) -> MutexGuard<'_, Connection> {
        // A poisoned mutex (a panic in another command) must not crash
        // the whole application - the connection remains valid.
        self.conn.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn checkout_read(&self) -> Option<Connection> {
        self.readers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pop()
    }

    fn return_read(&self, conn: Connection) {
        self.readers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(conn);
    }

    fn invalidate_search_cache(&self) {
        self.search_generation.fetch_add(1, Ordering::SeqCst);
        self.search_cache
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }

    /// Connection access for tests (e.g. tweaking sync_meta).
    #[cfg(test)]
    pub fn conn_for_tests(&self) -> &Arc<Mutex<Connection>> {
        &self.conn
    }
}
