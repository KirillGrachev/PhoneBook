//! Константы схемы: версия, DDL и набор колонок выборок.
//!
//! Комментарии к колонкам — часть поставки: структуру базы читают
//! не только запросы, но и люди.

use rusqlite::Connection;
use tracing::warn;

use crate::error::AppError;

/// Версия схемы кэша (`PRAGMA user_version`).
///
/// v2: триграммный индекс `users_substr` для поиска подстрок без полного
/// LIKE-скана таблицы. Кэш — восстанавливаемое зеркало AD, поэтому смена
/// версии просто пересоздаёт его ([`ensure_schema`]).
pub(super) const SCHEMA_VERSION: i64 = 2;

/// Колонки выборки сотрудника — порядок строго соответствует
/// [`row_to_employee`]. Значения справочников берутся через JOIN:
/// `sources.name` — источник синхронизации, `departments.name` —
/// подразделение, `orgs.name` — организация, `locations.name` — кабинет.
pub(super) const EMPLOYEE_COLUMNS: &str =
    "users.object_guid, sources.name, users.sam_account_name, \
     users.first_name, users.last_name, users.middle_name, users.display_name, users.title, \
     departments.name, orgs.name, locations.name, users.email, users.ip_phone, \
     users.phone_external, users.phone_mobile, users.manager, users.usn_changed, \
     users.updated_at, users.pager";

/// Общая часть всех выборок: присоединение источника и справочников к `users`.
///
/// `JOIN sources` — источник есть у пользователя всегда; справочники
/// присоединены через `LEFT JOIN` — организация/подразделение/кабинет могут
/// быть не заполнены. Все соединения «один к одному или нулю», строки не
/// дублируются, поэтому `COUNT(*)` с теми же JOIN даёт точное число.
pub(super) const LOOKUP_JOINS: &str = " JOIN sources ON sources.id = users.source_id \
     LEFT JOIN orgs ON orgs.id = users.org_id \
     LEFT JOIN departments ON departments.id = users.department_id \
     LEFT JOIN locations ON locations.id = users.location_id";
/// Актуальная схема. Комментарии к колонкам — часть поставки:
/// структуру базы читают не только запросы, но и люди.
pub(super) const CREATE_SCHEMA: &str = "
-- Источник синхронизации: подключение к AD из настроек приложения.
CREATE TABLE IF NOT EXISTS sources (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Организации (AD `company`): одна строка на группу вариантов написания.
CREATE TABLE IF NOT EXISTS orgs (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,             -- отображаемый вариант имени
    name_key TEXT NOT NULL UNIQUE       -- нормализованный ключ: нижний регистр, без лишних пробелов
);

-- Подразделения (AD `department`).
CREATE TABLE IF NOT EXISTS departments (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Кабинеты/адреса (AD `physicalDeliveryOfficeName`).
CREATE TABLE IF NOT EXISTS locations (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Сотрудники. Повторяющиеся значения вынесены в справочники (FK),
-- текст хранится один раз; каскады поддерживают кэш согласованным.
CREATE TABLE IF NOT EXISTS users (
    object_guid      TEXT PRIMARY KEY,  -- AD objectGUID, неизменяемый
    source_id        INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    org_id           INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
    department_id    INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    location_id      INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    sam_account_name TEXT,              -- учётная запись (AD sAMAccountName)
    first_name       TEXT,
    last_name        TEXT,
    middle_name      TEXT,
    display_name     TEXT NOT NULL,     -- отображаемое имя (AD displayName / CN)
    sort_key         TEXT NOT NULL,     -- имя в нижнем регистре: сортировка с учётом кириллицы
    title            TEXT,              -- должность (AD title)
    email            TEXT,              -- AD mail
    ip_phone         TEXT,              -- внутренний номер IP-телефонии (AD ipPhone)
    phone_external   TEXT,              -- внешний/городской номер
    phone_mobile     TEXT,              -- мобильный (AD mobile)
    pager            TEXT,              -- TrueConf ID (AD pager)
    manager          TEXT,              -- имя руководителя (разрешается из DN при синхронизации)
    usn_changed      INTEGER,           -- AD uSNChanged: метка изменений для инкрементальной синхронизации
    updated_at       INTEGER NOT NULL   -- время обновления записи, unix-секунды
);

CREATE INDEX IF NOT EXISTS idx_users_source     ON users(source_id);
CREATE INDEX IF NOT EXISTS idx_users_org        ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_sort_key   ON users(sort_key);

-- Поисковый индекс FTS5. Денормализация здесь осознанная: индекс
-- пересоздаётся при каждой синхронизации организации и не участвует
-- в хранении справочных значений.
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

-- Триграммный индекс для поиска подстрок («бухг» → «Бухгалтерия», хвосты
-- телефонов в любом форматировании) без LIKE-скана по всем строкам.
-- Значения хранятся приведёнными: hay — в нижнем регистре (Unicode-фолдинг
-- делает Rust, SQLite lower() не знает кириллицу), phones — только цифры;
-- триграммы case_sensitive, поэтому запрос приходит уже нормализованным.
CREATE VIRTUAL TABLE IF NOT EXISTS users_substr USING fts5(
    object_guid UNINDEXED,
    hay,
    phones,
    tokenize = 'trigram case_sensitive 1'
);

-- Мета последней синхронизации каждого источника.
CREATE TABLE IF NOT EXISTS sync_meta (
    source_id    INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    last_sync_at INTEGER,
    last_count   INTEGER,
    last_error   TEXT
);
";

/// Привести схему кэша к актуальной версии.
///
/// Кэш — полностью восстанавливаемое зеркало Active Directory (избранное и
/// настройки живут в `config.json`, пароли — в системном хранилище), поэтому
/// переносы данных между версиями схемы не нужны: при несовпадении штампа
/// `PRAGMA user_version` таблицы кэша пересоздаются с нуля, а содержимое
/// восстановит ближайшая синхронизация. Совпадение версии — no-op.
pub(super) fn ensure_schema(conn: &Connection) -> Result<(), AppError> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == SCHEMA_VERSION {
        return Ok(());
    }
    if version != 0 {
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
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}
