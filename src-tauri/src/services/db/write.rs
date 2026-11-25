//! Write operations: full replacement of a source cache and sync metadata.

use std::collections::{HashMap, HashSet};

use rusqlite::Transaction;

use crate::error::AppError;

use super::lookups::{resolve_lookup, resolve_org, source_kind, upsert_source};
use super::model::{OrgSyncMeta, UserRecord};
use super::{unix_now, Db};

impl Db {
    /// Fully replaces the AD source cache: upsert of received records,
    /// deletion of disappeared records, lookup cleanup, and `sync_meta` update -
    /// in one transaction.
    pub fn replace_org_users(
        &self,
        source_org: &str,
        users: &[UserRecord],
    ) -> Result<usize, AppError> {
        self.invalidate_search_cache();
        let mut conn = self.lock();
        let now = unix_now();
        let tx = conn.transaction()?;
        {
            let source_id = upsert_source(&tx, source_org, source_kind::AD)?;
            insert_users(&tx, source_id, users, now)?;
            delete_vanished(&tx, source_id)?;
            cleanup_orphans(&tx)?;
            // A full cache rebuild changes the data distribution: we update
            // scheduler statistics after a large sync.
            tx.execute_batch("PRAGMA optimize;")?;
            upsert_sync_meta(&tx, source_id, users.len(), max_usn(users), true)?;
        }
        tx.commit()?;
        drop(conn);
        // The cache changed — the container on disk must stay current.
        self.flush()?;
        Ok(users.len())
    }

    /// Applies the `uSNChanged` delta without removing disappeared records: deletions
    /// arrive only via a full selection (periodic or manual).
    pub fn merge_org_users(
        &self,
        source_org: &str,
        users: &[UserRecord],
    ) -> Result<usize, AppError> {
        self.invalidate_search_cache();
        let mut conn = self.lock();
        let now = unix_now();
        let tx = conn.transaction()?;
        let total = {
            let source_id = upsert_source(&tx, source_org, source_kind::AD)?;
            insert_users(&tx, source_id, users, now)?;
            let total: i64 = tx.query_row(
                "SELECT COUNT(*) FROM users WHERE source_id = ?1",
                [source_id],
                |row| row.get(0),
            )?;
            upsert_sync_meta(&tx, source_id, total as usize, max_usn(users), false)?;
            total as usize
        };
        tx.commit()?;
        drop(conn);
        self.flush()?;
        Ok(total)
    }

    /// Fully replaces the external phone file cache
    /// ([`crate::services::external`]): the same steps as for an AD source,
    /// plus deletion of the previous external source's records (the file header
    /// renamed, the file was replaced with another) - in one transaction.
    #[cfg(test)]
    pub fn replace_external_users(
        &self,
        organization: &str,
        users: &[UserRecord],
    ) -> Result<usize, AppError> {
        self.invalidate_search_cache();
        let mut conn = self.lock();
        let now = unix_now();
        let tx = conn.transaction()?;
        {
            let source_id = upsert_source(&tx, organization, source_kind::EXTERNAL)?;
            insert_users(&tx, source_id, users, now)?;
            delete_vanished(&tx, source_id)?;
            tx.execute(
                "DELETE FROM users WHERE source_id IN
                    (SELECT id FROM sources WHERE kind = ?1 AND id != ?2)",
                rusqlite::params![source_kind::EXTERNAL, source_id],
            )?;
            cleanup_orphans(&tx)?;
            tx.execute_batch("PRAGMA optimize;")?;
            upsert_sync_meta(&tx, source_id, users.len(), None, true)?;
        }
        tx.commit()?;
        drop(conn);
        self.flush()?;
        Ok(users.len())
    }

    /// Replaces all external phone book sources atomically. Every selected file
    /// is one source; sources that disappeared from the selection are removed.
    pub fn replace_external_sources(
        &self,
        sources: &[(String, Vec<UserRecord>)],
    ) -> Result<usize, AppError> {
        self.invalidate_search_cache();
        let mut conn = self.lock();
        let now = unix_now();
        let tx = conn.transaction()?;
        let mut total = 0usize;
        {
            tx.execute(
                "DELETE FROM sources WHERE kind = ?1",
                rusqlite::params![source_kind::EXTERNAL],
            )?;
            for (organization, users) in sources {
                let source_id = upsert_source(&tx, organization, source_kind::EXTERNAL)?;
                insert_users(&tx, source_id, users, now)?;
                upsert_sync_meta(&tx, source_id, users.len(), None, true)?;
                total += users.len();
            }
            cleanup_orphans(&tx)?;
            tx.execute_batch("PRAGMA optimize;")?;
        }
        tx.commit()?;
        drop(conn);
        self.flush()?;
        Ok(total)
    }

    /// Removes all external phone file records from the cache (the option is off
    /// or the path is unset). Returns the number of records that disappeared from results.
    /// Sync metadata is cascaded away together with sources.
    pub fn clear_external_users(&self) -> Result<usize, AppError> {
        self.invalidate_search_cache();
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        let removed = tx.execute(
            "DELETE FROM users WHERE source_id IN
                (SELECT id FROM sources WHERE kind = ?1)",
            rusqlite::params![source_kind::EXTERNAL],
        )?;
        cleanup_orphans(&tx)?;
        tx.execute(
            "DELETE FROM sources WHERE kind = ?1",
            rusqlite::params![source_kind::EXTERNAL],
        )?;
        tx.commit()?;
        drop(conn);
        if removed > 0 {
            self.flush()?;
        }
        Ok(removed)
    }

    pub fn set_sync_error(&self, organization: &str, message: &str) -> Result<(), AppError> {
        let conn = self.lock();
        // The source is created even on a failed first sync —
        // the error must be visible in settings.
        let source_id = upsert_source(&conn, organization, source_kind::AD)?;
        conn.execute(
            "INSERT INTO sync_meta (source_id, last_sync_at, last_count, last_error)
             VALUES (?1, NULL, NULL, ?2)
             ON CONFLICT(source_id) DO UPDATE SET last_error = excluded.last_error",
            rusqlite::params![source_id, message],
        )?;
        drop(conn);
        self.flush()?;
        Ok(())
    }

    pub fn sync_meta(&self) -> Result<Vec<OrgSyncMeta>, AppError> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT sources.name, sync_meta.last_sync_at, sync_meta.last_count, sync_meta.last_error,
                    sync_meta.last_usn, sync_meta.last_full_sync_at
             FROM sync_meta
             JOIN sources ON sources.id = sync_meta.source_id
             ORDER BY sources.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(OrgSyncMeta {
                organization: row.get(0)?,
                last_sync_at: row.get(1)?,
                last_count: row.get(2)?,
                last_error: row.get(3)?,
                last_usn: row.get(4)?,
                last_full_sync_at: row.get(5)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }
}

/// Inserts source records together with search indexes (FTS and
/// trigram). Records unchanged by `uSNChanged` are not rewritten:
/// a full LDAP selection must not rebuild the whole FTS every time.
///
/// Lookup values are resolved to ids once per unique value:
/// thousands of employees in one department do not hammer the database.
fn insert_users(
    tx: &Transaction<'_>,
    source_id: i64,
    users: &[UserRecord],
    now: i64,
) -> Result<(), AppError> {
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS seen_guids (object_guid TEXT PRIMARY KEY);
         CREATE TEMP TABLE IF NOT EXISTS changed_guids (object_guid TEXT PRIMARY KEY);
         DELETE FROM seen_guids;
         DELETE FROM changed_guids;",
    )?;

    // Which records actually changed since the last sync. uSNChanged
    // monotonic within the domain; on the first sync/for external
    // files (None) we consider all records changed.
    let existing: HashMap<String, Option<i64>> = {
        let mut stmt =
            tx.prepare("SELECT object_guid, usn_changed FROM users WHERE source_id = ?1")?;
        let rows = stmt.query_map([source_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    let mut changed: HashSet<String> = HashSet::new();
    for user in users {
        let unchanged = match (existing.get(&user.object_guid), user.usn_changed) {
            (Some(Some(previous)), Some(next)) => *previous == next,
            _ => false,
        };
        if !unchanged {
            changed.insert(user.object_guid.clone());
        }
    }

    let mut insert_user = tx.prepare(
        "INSERT OR REPLACE INTO users (
            object_guid, source_id, org_id, department_id, location_id,
            sam_account_name, first_name, last_name, middle_name,
            display_name, sort_key, title, email,
            ip_phone, phone_external, phone_mobile, pager, manager, manager_guid,
            usn_changed, updated_at, photo
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
    )?;
    let mut insert_seen =
        tx.prepare("INSERT OR IGNORE INTO seen_guids (object_guid) VALUES (?1)")?;
    let mut insert_changed =
        tx.prepare("INSERT OR IGNORE INTO changed_guids (object_guid) VALUES (?1)")?;
    // object_guid in FTS5 tables is UNINDEXED: deleting by a single guid is
    // a full index scan for every record (O(n^2) on a large sync).
    // Collect the batch into seen_guids and changed records into changed_guids: indexes are
    // fixed in one pass and only for records that actually changed.
    for user in users {
        insert_seen.execute(rusqlite::params![user.object_guid])?;
        if changed.contains(user.object_guid.as_str()) {
            insert_changed.execute(rusqlite::params![user.object_guid])?;
        }
    }
    drop(insert_seen);
    drop(insert_changed);
    tx.execute(
        "DELETE FROM users_fts WHERE object_guid IN (SELECT object_guid FROM changed_guids)",
        [],
    )?;
    tx.execute(
        "DELETE FROM users_substr WHERE object_guid IN (SELECT object_guid FROM changed_guids)",
        [],
    )?;
    let mut insert_substr =
        tx.prepare("INSERT INTO users_substr (object_guid, hay, phones) VALUES (?1, ?2, ?3)")?;
    let mut insert_fts = tx.prepare(
        "INSERT INTO users_fts (object_guid, display_name, department, company, title, email, tokens)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
    )?;

    let mut org_cache = HashMap::new();
    let mut department_cache = HashMap::new();
    let mut location_cache = HashMap::new();

    for user in users {
        if !changed.contains(user.object_guid.as_str()) {
            continue;
        }
        let org_id = resolve_org(tx, &mut org_cache, user.company.as_deref())?;
        let department_id = resolve_lookup(
            tx,
            &mut department_cache,
            "departments",
            user.department.as_deref(),
        )?;
        let location_id =
            resolve_lookup(tx, &mut location_cache, "locations", user.office.as_deref())?;

        insert_user.execute(rusqlite::params![
            user.object_guid,
            source_id,
            org_id,
            department_id,
            location_id,
            user.sam_account_name,
            user.first_name,
            user.last_name,
            user.middle_name,
            user.display_name,
            user.sort_key,
            user.title,
            user.email,
            user.ip_phone,
            user.phone_external,
            user.phone_mobile,
            user.pager,
            user.manager,
            user.manager_guid,
            user.usn_changed,
            now,
            user.photo,
        ])?;
        let (hay, phones) = substr_columns(user);
        insert_substr.execute(rusqlite::params![user.object_guid, hay, phones])?;
        insert_fts.execute(rusqlite::params![
            user.object_guid,
            user.display_name,
            user.department,
            user.company,
            user.title,
            user.email,
            user.tokens,
        ])?;
    }
    Ok(())
}

/// Deletes employees that disappeared from this source's catalog.
fn delete_vanished(tx: &Transaction<'_>, source_id: i64) -> Result<(), AppError> {
    tx.execute(
        "DELETE FROM users WHERE source_id = ?1 AND object_guid NOT IN (SELECT object_guid FROM seen_guids)",
        rusqlite::params![source_id],
    )?;
    Ok(())
}

/// Cleanup of orphaned search index rows and lookup values,
/// that no one references anymore (the department was disbanded, the organization
/// disappeared from AD, the external file is disabled).
fn cleanup_orphans(tx: &Transaction<'_>) -> Result<(), AppError> {
    tx.execute(
        "DELETE FROM users_fts WHERE object_guid NOT IN (SELECT object_guid FROM users)",
        [],
    )?;
    tx.execute(
        "DELETE FROM users_substr WHERE object_guid NOT IN (SELECT object_guid FROM users)",
        [],
    )?;
    tx.execute_batch(
        "DELETE FROM departments WHERE id NOT IN
            (SELECT department_id FROM users WHERE department_id IS NOT NULL);
         DELETE FROM locations WHERE id NOT IN
            (SELECT location_id FROM users WHERE location_id IS NOT NULL);
         DELETE FROM orgs WHERE id NOT IN
            (SELECT org_id FROM users WHERE org_id IS NOT NULL);",
    )?;
    Ok(())
}

/// Successful source sync metadata: time and number of received records,
/// the previous error is reset.
fn max_usn(users: &[UserRecord]) -> Option<i64> {
    users.iter().filter_map(|user| user.usn_changed).max()
}

fn upsert_sync_meta(
    tx: &Transaction<'_>,
    source_id: i64,
    count: usize,
    last_usn: Option<i64>,
    full: bool,
) -> Result<(), AppError> {
    let now = unix_now();
    let full_at = full.then_some(now);
    tx.execute(
        "INSERT INTO sync_meta
            (source_id, last_sync_at, last_count, last_error, last_usn, last_full_sync_at)
         VALUES (?1, ?2, ?3, NULL, ?4, ?5)
         ON CONFLICT(source_id) DO UPDATE SET
            last_sync_at      = excluded.last_sync_at,
            last_count        = excluded.last_count,
            last_error        = NULL,
            last_usn          = COALESCE(excluded.last_usn, sync_meta.last_usn),
            last_full_sync_at = COALESCE(excluded.last_full_sync_at, sync_meta.last_full_sync_at)",
        rusqlite::params![source_id, now, count as i64, last_usn, full_at],
    )?;
    Ok(())
}

/// Trigram index columns: hay - text fields in lowercase
/// (Unicode folding on the Rust side); phones - only phone digits,
/// so tails are found regardless of formatting.
fn substr_columns(user: &UserRecord) -> (String, String) {
    let hay = [
        user.display_name.as_str(),
        user.email.as_deref().unwrap_or_default(),
        user.department.as_deref().unwrap_or_default(),
        user.company.as_deref().unwrap_or_default(),
        user.office.as_deref().unwrap_or_default(),
        user.title.as_deref().unwrap_or_default(),
        user.sam_account_name.as_deref().unwrap_or_default(),
    ]
    .join(" ")
    .to_lowercase();
    let phones = [
        user.ip_phone.as_deref(),
        user.phone_external.as_deref(),
        user.phone_mobile.as_deref(),
    ]
    .iter()
    .flatten()
    .map(|phone| {
        phone
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect::<String>()
    })
    .collect::<Vec<_>>()
    .join(" ");
    (hay, phones)
}
