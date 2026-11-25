//! Schema constants: version, DDL, and the selection column set.
//!
//! Column comments are part of the delivery: the database structure is read
//! not only queries, but people.

use rusqlite::Connection;
use tracing::warn;

use crate::error::AppError;

/// Cache schema version (`PRAGMA user_version`).
///
/// v2: trigram index `users_substr` for substring search without a full
/// LIKE table scan; v3: `users.manager_guid` - clickable supervisor
/// (the card opens by GUID without a name search); v4: `sources.kind` -
/// the "external" source for external phone file records (Yealink
/// IPPhoneBook), loaded into the lookup equally with AD employees;
/// v5: `sync_meta.last_usn`/`last_full_sync_at` - delta sync.
/// v6: `users.photo` - avatar from AD `thumbnailPhoto` (BLOB, fetched on demand).
/// The cache is a recoverable mirror of AD, so a version change simply
/// recreates it ([`ensure_schema`]).
pub(super) const SCHEMA_VERSION: i64 = 6;

/// Employee selection columns - the order strictly matches
/// [`row_to_employee`]. Lookup values are fetched via JOIN:
/// `sources.name` - sync source, `departments.name` -
/// department, `orgs.name` - organization, `locations.name` - office.
pub(super) const EMPLOYEE_COLUMNS: &str =
    "users.object_guid, sources.name, users.sam_account_name, \
     users.first_name, users.last_name, users.middle_name, users.display_name, users.title, \
     departments.name, orgs.name, locations.name, users.email, users.ip_phone, \
     users.phone_external, users.phone_mobile, users.manager, users.usn_changed, \
     users.updated_at, users.pager, users.manager_guid";

/// Common part of all selections: joining the source and lookups to `users`.
///
/// `JOIN sources` - a user always has a source; lookups are
/// joined via `LEFT JOIN` - organization/department/office may
/// be unfilled. All relationships are "one-to-one-or-zero"; rows are not
/// duplicated, so `COUNT(*)` with the same JOINs gives the exact number.
pub(super) const LOOKUP_JOINS: &str = " JOIN sources ON sources.id = users.source_id \
     LEFT JOIN orgs ON orgs.id = users.org_id \
     LEFT JOIN departments ON departments.id = users.department_id \
     LEFT JOIN locations ON locations.id = users.location_id";
/// Current schema. Column comments are part of the delivery:
/// the database structure is read not only by queries, but by people.
pub(super) const CREATE_SCHEMA: &str = "
-- Sync source: AD connection from application settings
-- or an external phone file (kind = 'external').
CREATE TABLE IF NOT EXISTS sources (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'ad'   -- 'ad' - AD connection, 'external' - phone book file
);

-- Organizations (AD `company`): one row per group of spelling variants.
CREATE TABLE IF NOT EXISTS orgs (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,             -- display name variant
    name_key TEXT NOT NULL UNIQUE       -- normalized key: lowercase, no extra whitespace
);

-- Departments (AD `department`).
CREATE TABLE IF NOT EXISTS departments (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Offices/addresses (AD `physicalDeliveryOfficeName`).
CREATE TABLE IF NOT EXISTS locations (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Employees. Repeated values are moved to lookups (FK);
-- text is stored once; cascades keep the cache consistent.
CREATE TABLE IF NOT EXISTS users (
    object_guid      TEXT PRIMARY KEY,  -- AD objectGUID, immutable
    source_id        INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    org_id           INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
    department_id    INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    location_id      INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    sam_account_name TEXT,              -- account (AD sAMAccountName)
    first_name       TEXT,
    last_name        TEXT,
    middle_name      TEXT,
    display_name     TEXT NOT NULL,     -- display name (AD displayName / CN)
    sort_key         TEXT NOT NULL,     -- lowercase name: sorting that accounts for Cyrillic
    title            TEXT,              -- job title (AD title)
    email            TEXT,              -- AD mail
    ip_phone         TEXT,              -- internal IP telephony number (AD ipPhone)
    phone_external   TEXT,              -- external/landline number
    phone_mobile     TEXT,              -- mobile (AD mobile)
    pager            TEXT,              -- TrueConf ID (AD pager)
    manager          TEXT,              -- supervisor name (resolved from DN during sync)
    manager_guid     TEXT,              -- supervisor GUID: the card opens on click without a name search
    usn_changed      INTEGER,           -- AD uSNChanged: skip unchanged records during reindexing
    updated_at       INTEGER NOT NULL,  -- record update time, unix seconds
    photo            BLOB               -- avatar (AD thumbnailPhoto); NULL - letter avatar
);

CREATE INDEX IF NOT EXISTS idx_users_source     ON users(source_id);
CREATE INDEX IF NOT EXISTS idx_users_org        ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_sort_key   ON users(sort_key);

-- FTS5 search index. Denormalization here is intentional: the index
-- is rebuilt on every organization sync and does not participate
-- in storing lookup values.
CREATE VIRTUAL TABLE IF NOT EXISTS users_fts USING fts5(
    object_guid UNINDEXED,
    display_name,
    department,
    company,
    title,
    email,
    tokens,
    tokenize = 'unicode61'
);

-- Trigram index for substring search ('bukhg' -> 'Bukhgalteriya', phone
-- tails in any formatting) without a LIKE scan over all rows.
-- Values are stored normalized: hay - lowercase (Unicode folding
-- is done by Rust; SQLite lower() does not know Cyrillic), phones - digits only;
-- trigrams are case_sensitive, so the query arrives already normalized.
CREATE VIRTUAL TABLE IF NOT EXISTS users_substr USING fts5(
    object_guid UNINDEXED,
    hay,
    phones,
    tokenize = 'trigram case_sensitive 1'
);

-- Metadata of each source's last sync.
CREATE TABLE IF NOT EXISTS sync_meta (
    source_id         INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    last_sync_at      INTEGER,
    last_count        INTEGER,
    last_error        TEXT,
    -- uSNChanged up to which the cache is guaranteed applied (for delta).
    last_usn          INTEGER,
    -- When the last full selection was performed (for deletions).
    last_full_sync_at INTEGER
);
";

/// Structural schema self-check: key columns of the current version.
///
/// A single `PRAGMA user_version` stamp is not a guarantee: the database could have been created
/// "mixed" build whose version number is already current, while individual
/// tables - still old (partially applied updates, manual edits).
/// Each probe is an empty `SELECT`: if a column is missing it fails at the stage
/// query preparation, and costs nothing on a healthy schema.
const STRUCTURE_PROBES: &[&str] = &[
    "SELECT last_usn FROM sync_meta LIMIT 0", // v5 delta sync
    "SELECT last_full_sync_at FROM sync_meta LIMIT 0",
    "SELECT kind FROM sources LIMIT 0", // v4 external sources
    "SELECT manager_guid FROM users LIMIT 0", // v3 manager link
    "SELECT photo FROM users LIMIT 0",  // v6 avatar blob
    "SELECT pager FROM users LIMIT 0",  // TrueConf ID
    "SELECT usn_changed FROM users LIMIT 0", // delta bookkeeping
    "SELECT updated_at FROM users LIMIT 0",
    "SELECT sort_key FROM users LIMIT 0",
    "SELECT object_guid FROM users_substr LIMIT 0", // v2 substring index
    "SELECT hay FROM users_substr LIMIT 0",
    "SELECT tokens FROM users_fts LIMIT 0", // full-text index
];

/// Whether the table structure matches the current schema version.
fn structure_matches(conn: &Connection) -> bool {
    STRUCTURE_PROBES
        .iter()
        .all(|probe| conn.prepare(probe).is_ok())
}

/// Bring the cache schema to the current version.
///
/// The cache is a fully recoverable mirror of Active Directory (starred contacts and
/// settings live in `config.json`, passwords in the system store), therefore
/// data migrations between schema versions are not needed: on a mismatch of
/// `PRAGMA user_version` **or** a structural self-check failure
/// ([`STRUCTURE_PROBES`]) the cache tables are recreated from scratch, and the contents
/// are restored by the nearest sync. A version and structure match is a no-op.
pub(super) fn ensure_schema(conn: &Connection) -> Result<(), AppError> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let structure_ok = version == SCHEMA_VERSION && structure_matches(conn);
    if structure_ok {
        return Ok(());
    }
    if version == SCHEMA_VERSION {
        warn!(
            target: "db",
            version,
            "структура кэша не соответствует версии схемы — кэш пересоздан"
        );
    } else if version != 0 {
        warn!(
            target: "db",
            from = version,
            to = SCHEMA_VERSION,
            "версия схемы кэша не совпадает с актуальной — кэш пересоздан"
        );
    }
    conn.execute_batch(
        "DROP TABLE IF EXISTS users_fts;
         DROP TABLE IF EXISTS users_substr;
         DROP TABLE IF EXISTS users;
         DROP TABLE IF EXISTS sync_meta;
         DROP TABLE IF EXISTS departments;
         DROP TABLE IF EXISTS locations;
         DROP TABLE IF EXISTS orgs;
         DROP TABLE IF EXISTS sources;",
    )?;
    conn.execute_batch(CREATE_SCHEMA)?;
    // Self-check after recreation: if the key columns are still missing,
    // means `CREATE_SCHEMA` itself is outdated in the build - report it explicitly, instead
    // so that sync does not later fail with "no such column".
    if !structure_matches(conn) {
        return Err(AppError::Db(
            "самопроверка схемы после пересоздания не прошла".to_string(),
        ));
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}
