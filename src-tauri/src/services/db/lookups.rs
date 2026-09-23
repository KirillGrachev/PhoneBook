//! Разрешение текстовых значений в справочники: источники, организации,
//! подразделения, кабинеты. Повторы схлопываются ограничениями UNIQUE,
//! кэш в памяти экономит запросы в пределах одной синхронизации.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::error::AppError;

/// Строка источника синхронизации: создаётся при первом обращении.
pub(super) fn upsert_source(conn: &Connection, name: &str) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO sources (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
        rusqlite::params![name],
    )?;
    Ok(conn.query_row(
        "SELECT id FROM sources WHERE name = ?1",
        rusqlite::params![name],
        |row| row.get(0),
    )?)
}

/// Id организации по значению AD-атрибута `company`.
///
/// Дедупликация — по нормализованному ключу (`name_key`): «КМАруда»,
/// «КМАРУДА» и «КМАруда » — одна организация. Отображаемое имя —
/// байтовый максимум вариантов (строчная кириллица > заглавной, поэтому
/// смешанное написание побеждает капс — то же правило, что и
/// `MAX(TRIM(company))` по группе вариантов).
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

/// Id строки простого справочника (`departments`/`locations`): значение
/// хранится один раз, повторы разрешаются через кэш. `table` — константа
/// компиляции, пользователю не передаётся: подстановка в SQL безопасна.
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
