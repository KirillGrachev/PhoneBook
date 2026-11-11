//! Операции записи: полная замена кэша источника и мета синхронизации.

use std::collections::{HashMap, HashSet};

use rusqlite::Transaction;

use crate::error::AppError;

use super::lookups::{resolve_lookup, resolve_org, source_kind, upsert_source};
use super::model::{OrgSyncMeta, UserRecord};
use super::{unix_now, Db};

impl Db {
    /// Полностью заменяет кэш источника AD: upsert полученных записей,
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
            let source_id = upsert_source(&tx, source_org, source_kind::AD)?;
            insert_users(&tx, source_id, users, now)?;
            delete_vanished(&tx, source_id)?;
            cleanup_orphans(&tx)?;
            upsert_sync_meta(&tx, source_id, users.len(), max_usn(users), true)?;
        }
        tx.commit()?;
        drop(conn);
        // Кэш изменён — контейнер на диске должен остаться актуальным.
        self.flush()?;
        Ok(users.len())
    }

    /// Применяет дельту `uSNChanged` без удаления исчезнувших: удаления
    /// приходят только полной выборкой (периодической или ручной).
    pub fn merge_org_users(
        &self,
        source_org: &str,
        users: &[UserRecord],
    ) -> Result<usize, AppError> {
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

    /// Полностью заменяет кэш внешнего телефонного файла
    /// ([`crate::services::external`]): те же шаги, что и у источника AD,
    /// плюс удаление записей прежнего внешнего источника (заголовок файла
    /// переименован, файл заменён на другой) — в одной транзакции.
    pub fn replace_external_users(
        &self,
        organization: &str,
        users: &[UserRecord],
    ) -> Result<usize, AppError> {
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
            upsert_sync_meta(&tx, source_id, users.len(), None, true)?;
        }
        tx.commit()?;
        drop(conn);
        self.flush()?;
        Ok(users.len())
    }

    /// Убирает из кэша все записи внешних телефонных файлов (опция выключена
    /// или путь не задан). Возвращает число записей, исчезнувших из выдачи.
    /// Мета синхронизации уходит каскадом вместе с источниками.
    pub fn clear_external_users(&self) -> Result<usize, AppError> {
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
        // Источник создаётся даже при неудачной первой синхронизации —
        // ошибка должна быть видна в настройках.
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

/// Вставляет записи источника вместе с поисковыми индексами (FTS и
/// триграммный). Неизменённые по `uSNChanged` записи не перезаписываются:
/// полная LDAP-выборка не должна каждый раз перестраивать весь FTS.
///
/// Справочные значения разрешаются в id один раз на уникальное значение:
/// тысячи сотрудников одного отдела не долбят базу.
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

    // Какие записи реально изменились с прошлой синхронизации. uSNChanged
    // монотонен в пределах домена; при первом синхронизации/для внешних
    // файлов (None) считаем изменёнными все записи.
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
            usn_changed, updated_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)",
    )?;
    let mut insert_seen =
        tx.prepare("INSERT OR IGNORE INTO seen_guids (object_guid) VALUES (?1)")?;
    let mut insert_changed =
        tx.prepare("INSERT OR IGNORE INTO changed_guids (object_guid) VALUES (?1)")?;
    // object_guid в FTS5-таблицах UNINDEXED: удаление по одному guid — это
    // полный скан индекса на каждую запись (O(n²) на большой синхронизации).
    // Собираем батч в seen_guids, а изменённые — в changed_guids: индексы
    // чинятся одним проходом и только для реально изменившихся записей.
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

/// Удаляет сотрудников, исчезнувших из каталога этого источника.
fn delete_vanished(tx: &Transaction<'_>, source_id: i64) -> Result<(), AppError> {
    tx.execute(
        "DELETE FROM users WHERE source_id = ?1 AND object_guid NOT IN (SELECT object_guid FROM seen_guids)",
        rusqlite::params![source_id],
    )?;
    Ok(())
}

/// Чистка осиротевших строк поисковых индексов и значений справочников,
/// на которые больше никто не ссылается (отдел расформирован, организация
/// исчезла из AD, внешний файл отключён).
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

/// Мета успешной синхронизации источника: время и число полученных записей,
/// прежняя ошибка сбрасывается.
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
    .collect::<Vec<_>>()
    .join(" ");
    (hay, phones)
}
