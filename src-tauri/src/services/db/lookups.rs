//! Resolving text values into lookups: sources, organizations,
//! departments, offices. Duplicates are collapsed by UNIQUE constraints,
//! the in-memory cache saves queries within a single sync.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::error::AppError;

/// Sync source type: the value of the `sources.kind` column.
pub(super) mod source_kind {
    /// Active Directory connection from application settings.
    pub const AD: &str = "ad";
    /// External phone file (Yealink IPPhoneBook).
    pub const EXTERNAL: &str = "external";
}

/// Sync source row: created on first access.
///
/// `kind` is updated on a name collision: the source name is unique, while the type
/// determines which mechanism owns the source cache (AD sync or
/// external file) - callers exclude collisions before reaching here.
pub(super) fn upsert_source(conn: &Connection, name: &str, kind: &str) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO sources (name, kind) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET kind = excluded.kind",
        rusqlite::params![name, kind],
    )?;
    Ok(conn.query_row(
        "SELECT id FROM sources WHERE name = ?1",
        rusqlite::params![name],
        |row| row.get(0),
    )?)
}

/// Organization id by the value of the AD `company` attribute.
///
/// Deduplication by normalized key (`name_key`): "KMAruda",
/// "KMARUDA" and "KMAruda " are one organization. The display name is the
/// byte-wise maximum of the variants (lowercase Cyrillic > uppercase, therefore
/// mixed case beats all caps - the same rule as
/// `MAX(TRIM(company))` per variant group).
pub(super) fn resolve_org(
    conn: &Connection,
    cache: &mut HashMap<String, i64>,
    company: Option<&str>,
) -> Result<Option<i64>, AppError> {
    let Some(name) = company.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if let Some(id) = cache.get(name) {
        return Ok(Some(*id));
    }
    let key = crate::services::tokens::company_key(name);
    conn.execute(
        "INSERT INTO orgs (name, name_key) VALUES (?1, ?2)
         ON CONFLICT(name_key) DO UPDATE SET name = excluded.name
         WHERE excluded.name > orgs.name",
        rusqlite::params![name, key],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM orgs WHERE name_key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )?;
    cache.insert(name.to_string(), id);
    Ok(Some(id))
}

/// Row id of a simple lookup (`departments`/`locations`): the value
/// stored once; repeats are resolved through the cache. `table` is a constant
/// compile time, not passed to the user: SQL substitution is safe.
pub(super) fn resolve_lookup(
    conn: &Connection,
    cache: &mut HashMap<String, i64>,
    table: &'static str,
    value: Option<&str>,
) -> Result<Option<i64>, AppError> {
    let Some(name) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if let Some(id) = cache.get(name) {
        return Ok(Some(*id));
    }
    conn.execute(
        &format!("INSERT INTO {table} (name) VALUES (?1) ON CONFLICT(name) DO NOTHING"),
        rusqlite::params![name],
    )?;
    let id: i64 = conn.query_row(
        &format!("SELECT id FROM {table} WHERE name = ?1"),
        rusqlite::params![name],
        |row| row.get(0),
    )?;
    cache.insert(name.to_string(), id);
    Ok(Some(id))
}
