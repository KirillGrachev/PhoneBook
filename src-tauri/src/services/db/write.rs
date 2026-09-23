//! Операции записи: полная замена кэша организации и мета синхронизации.

use std::collections::HashMap;

use crate::error::AppError;

use super::lookups::{resolve_lookup, resolve_org, upsert_source};
use super::model::{OrgSyncMeta, UserRecord};
use super::{unix_now, Db};

impl Db {
    /// Полностью заменяет кэш организации: upsert полученных записей,
    /// удаление исчезнувших, чистка справочников и обновление `sync_meta` —
    /// в одной транзакции.
    pub fn replace_org_users(
        &self,
        source_org: &str,
        users: &[UserRecord],
    ) -> Result<usize, AppError> {
        let mut conn = self.lock();
        let now = unix_now();
        let tx = conn.transaction()?;
        {
            let source_id = upsert_source(&tx, source_org)?;
            tx.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS seen_guids (object_guid TEXT PRIMARY KEY);
                 DELETE FROM seen_guids;",
            )?;

            let mut insert_user = tx.prepare(
                "INSERT OR REPLACE INTO users (
                    object_guid, source_id, org_id, department_id, location_id,
                    sam_account_name, first_name, last_name, middle_name,
                    display_name, sort_key, title, email,
                    ip_phone, phone_external, phone_mobile, pager, manager,
                    usn_changed, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
            )?;
            let mut insert_seen =
                tx.prepare("INSERT OR IGNORE INTO seen_guids (object_guid) VALUES (?1)")?;
            let mut delete_fts = tx.prepare("DELETE FROM users_fts WHERE object_guid = ?1")?;
            let mut delete_substr =
                tx.prepare("DELETE FROM users_substr WHERE object_guid = ?1")?;
            let mut insert_substr = tx.prepare(
                "INSERT INTO users_substr (object_guid, hay, phones) VALUES (?1, ?2, ?3)",
            )?;
            let mut insert_fts = tx.prepare(
                "INSERT INTO users_fts (object_guid, display_name, department, company, title, email, tokens)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
            )?;

            // Справочные значения разрешаются в id один раз на уникальное
            // значение: тысячи сотрудников одного отдела не долбят базу.
            let mut org_cache = HashMap::new();
            let mut department_cache = HashMap::new();
            let mut location_cache = HashMap::new();

            for user in users {
                let org_id = resolve_org(&tx, &mut org_cache, user.company.as_deref())?;
                let department_id = resolve_lookup(
                    &tx,
                    &mut department_cache,
                    "departments",
                    user.department.as_deref(),
                )?;
                let location_id = resolve_lookup(
                    &tx,
                    &mut location_cache,
                    "locations",
                    user.office.as_deref(),
                )?;

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
                    user.usn_changed,
                    now,
                ])?;
                insert_seen.execute(rusqlite::params![user.object_guid])?;
                delete_fts.execute(rusqlite::params![user.object_guid])?;
                delete_substr.execute(rusqlite::params![user.object_guid])?;
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

            // Удаляем сотрудников, исчезнувших из каталога этой организации.
            tx.execute(
                "DELETE FROM users WHERE source_id = ?1 AND object_guid NOT IN (SELECT object_guid FROM seen_guids)",
                rusqlite::params![source_id],
            )?;
            // Чистим осиротевшие строки FTS.
            tx.execute(
                "DELETE FROM users_fts WHERE object_guid NOT IN (SELECT object_guid FROM users)",
                [],
            )?;
            tx.execute(
                "DELETE FROM users_substr WHERE object_guid NOT IN (SELECT object_guid FROM users)",
                [],
            )?;
            // Удаляем значения справочников, на которые больше никто не
            // ссылается (отдел расформирован, организация исчезла из AD).
            tx.execute_batch(
                "DELETE FROM departments WHERE id NOT IN
                    (SELECT department_id FROM users WHERE department_id IS NOT NULL);
                 DELETE FROM locations WHERE id NOT IN
                    (SELECT location_id FROM users WHERE location_id IS NOT NULL);
                 DELETE FROM orgs WHERE id NOT IN
                    (SELECT org_id FROM users WHERE org_id IS NOT NULL);",
            )?;
            tx.execute(
                "INSERT INTO sync_meta (source_id, last_sync_at, last_count, last_error)
                 VALUES (?1, ?2, ?3, NULL)
                 ON CONFLICT(source_id) DO UPDATE SET
                    last_sync_at = excluded.last_sync_at,
                    last_count   = excluded.last_count,
                    last_error   = NULL",
                rusqlite::params![source_id, now, users.len() as i64],
            )?;
        }
        tx.commit()?;
        drop(conn);
        // Кэш изменён — контейнер на диске должен остаться актуальным.
        self.flush()?;
        Ok(users.len())
    }

    pub fn set_sync_error(&self, organization: &str, message: &str) -> Result<(), AppError> {
        let conn = self.lock();
        // Источник создаётся даже при неудачной первой синхронизации —
        // ошибка должна быть видна в настройках.
        let source_id = upsert_source(&conn, organization)?;
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
            "SELECT sources.name, sync_meta.last_sync_at, sync_meta.last_count, sync_meta.last_error
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
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }
}

/// Колонки триграммного индекса: hay — текстовые поля в нижнем регистре
/// (Unicode-фолдинг на стороне Rust), phones — только цифры телефонов,
/// чтобы хвосты находились независимо от форматирования.
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
    .filter(|digits| !digits.is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    (hay, phones)
}
