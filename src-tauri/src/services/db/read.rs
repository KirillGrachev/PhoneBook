//! Читательские запросы: поиск (FTS5 + LIKE-фолбэк), счётчики, выборки.

use rusqlite::{params_from_iter, Connection, OptionalExtension, Row, ToSql};

use crate::error::AppError;

use super::model::{Employee, SearchPage, SearchParams};
use super::schema::{EMPLOYEE_COLUMNS, LOOKUP_JOINS};
use super::Db;

/// Значение динамического SQL-параметра.
///
/// Количество параметров зависит от запроса, а `params_from_iter` требует
/// `Item: ToSql`. Собственная обёртка делает гетерогенные наборы параметров
/// типобезопасными и не полагается на тонкости trait-object impl'ов rusqlite.
#[derive(Debug, Clone)]
enum SqlValue {
    Text(String),
    Int(i64),
}

impl ToSql for SqlValue {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(match self {
            SqlValue::Text(value) => value.as_str().into(),
            SqlValue::Int(value) => (*value).into(),
        })
    }
}
impl Db {
    pub fn search(&self, search: SearchParams) -> Result<SearchPage, AppError> {
        let conn = self.lock();
        let mut search = search;
        Self::normalize_org_filter(&conn, &mut search)?;
        // limit = 0 означает «вся выдача»: каталог целиком уходит в виртуализированный список.
        let raw_limit = search.limit.unwrap_or(300);
        let limit = if raw_limit == 0 {
            i64::MAX
        } else {
            i64::from(raw_limit.clamp(1, 10000))
        };

        if let Some(ids) = search.ids.as_ref().filter(|ids| !ids.is_empty()) {
            let items = Self::by_ids(&conn, ids)?;
            let total = items.len() as u64;
            return Ok(SearchPage { items, total });
        }

        // Запрос санитизируется до букв/цифр/пробелов: пунктуация (запятая,
        // точки, скобки) не попадает ни в триграммные фразы, ни в LIKE —
        // в hay её нет, а раскладочные карты лишь путают (`,` ⇄ `б`).
        // Пустой после санитизации запрос равносилен просмотру без поиска.
        let query = search
            .query
            .as_deref()
            .map(|q| {
                q.chars()
                    .filter(|c| c.is_alphanumeric() || c.is_whitespace())
                    .collect::<String>()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .filter(|q| !q.is_empty());

        let (items, total) = if let Some(q) = query {
            let match_expr = crate::services::tokens::build_fts_query(&q);
            let mut fts_count = 0u64;
            let mut items = Vec::new();
            if let Some(expr) = match_expr.as_deref() {
                fts_count = Self::fts_count(&conn, expr, &search)?;
                items = Self::fts_search(&conn, expr, &search, limit)?;
            }
            // FTS5 ищет только по префиксам токенов. Дополняем выдачу
            // совпадениями, которые префиксный поиск не видит: подстроки
            // середины слова («бухг» → «Бухгалтерия») и телефоны в любом
            // форматировании. Подстроки от 3 символов идут через триграммный
            // индекс `users_substr` без скана таблицы; короче — LIKE.
            if let Some((conditions, args)) = Self::complement_conditions(&q, &search) {
                if (items.len() as i64) < limit {
                    for employee in Self::complement_search(&conn, &conditions, &args, limit)? {
                        if (items.len() as i64) >= limit {
                            break;
                        }
                        if !items.iter().any(|r| r.object_guid == employee.object_guid) {
                            items.push(employee);
                        }
                    }
                }
                // Точное общее число: FTS-совпадения + совпадения только дополнения.
                let complement_only =
                    Self::complement_only_count(&conn, &conditions, &args, match_expr.as_deref())?;
                (items, fts_count + complement_only)
            } else {
                (items, fts_count)
            }
        } else {
            let total = Self::browse_count(&conn, &search)?;
            let items = Self::browse(&conn, &search, limit)?;
            (items, total)
        };
        Ok(SearchPage { items, total })
    }

    /// Привязывает фильтры `organization` / `organizations` к справочнику
    /// `orgs` (AD `company`).
    ///
    /// Имя организации из настроек AD-подключения может не совпадать посимвольно
    /// со значением атрибута `company` («КМАруда» ⇄ «АО Комбинат КМАруда»),
    /// а вкладка предприятия обязана искать именно по предприятию, а не по
    /// всему источнику синхронизации (один домен может держать весь холдинг).
    /// `organizations` — союз имён группы фильтров из настроек: каждое имя
    /// разрешается независимо, выдача учитывает объединение (см.
    /// [`Self::normalize_org_union`]).
    /// Разрешение имени, по убыванию точности:
    /// * точное совпадение нормализованного ключа — обычное path фильтра;
    /// * единственный справочник, взаимно содержащий ключ подстрокой;
    /// * фолбэк на источник синхронизации с тем же именем — только когда
    ///   `source_org` продублирован тем же значением и таких организаций нет:
    ///   вкладка предприятия деградирует до «весь источник», но не пустеет.
    fn normalize_org_filter(conn: &Connection, search: &mut SearchParams) -> Result<(), AppError> {
        if let Some(orgs) = search.organizations.clone() {
            return Self::normalize_org_union(conn, search, &orgs);
        }
        let org = match search
            .organization
            .as_deref()
            .map(str::trim)
            .filter(|o| !o.is_empty())
        {
            Some(org) => org,
            None => return Ok(()),
        };
        let key = crate::services::tokens::company_key(org);
        match Self::resolve_org_key(conn, org)? {
            // Точное совпадение ключа — обычный path фильтра.
            Some(resolved) if resolved == key => Ok(()),
            Some(resolved) => {
                search.organization = Some(resolved);
                Ok(())
            }
            None => {
                let same_source = search.source_org.as_deref().map(str::trim) == Some(org);
                let has_source: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM sources WHERE name = ?1",
                    [org],
                    |row| row.get(0),
                )?;
                if same_source && has_source > 0 {
                    search.organization = None;
                }
                Ok(())
            }
        }
    }

    /// Разрешает имена группы организаций в ключи справочника `orgs`.
    ///
    /// Каждое имя разрешается независимо ([`Self::resolve_org_key`]); союз
    /// ключей уходит в `IN (...)`-фильтр выдачи. Неразрешённые имена в союз
    /// не попадают. Если не разрешилось ни одно имя:
    /// * пара с непустым `source_org` (маркер вкладки предприятия) —
    ///   фолбэк на источник синхронизации, список не пустеет;
    /// * строгая группа (без маркера) — `Some(vec![])`: выдача пуста,
    ///   а не «весь холдинг»: исчезнувшие из AD организации группы не
    ///   должны подменять фильтр отсутствием фильтра.
    fn normalize_org_union(
        conn: &Connection,
        search: &mut SearchParams,
        orgs: &[String],
    ) -> Result<(), AppError> {
        let names: Vec<&str> = orgs
            .iter()
            .map(|org| org.as_str().trim())
            .filter(|o| !o.is_empty())
            .collect();
        if names.is_empty() {
            search.organizations = None;
            return Ok(());
        }
        let mut keys: Vec<String> = Vec::with_capacity(names.len());
        for name in names {
            if let Some(key) = Self::resolve_org_key(conn, name)? {
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
        if keys.is_empty() {
            let source = search
                .source_org
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            if let Some(source) = source {
                let has_source: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM sources WHERE name = ?1",
                    [source],
                    |row| row.get(0),
                )?;
                if has_source > 0 {
                    search.organizations = None;
                    return Ok(());
                }
            }
            search.organizations = Some(Vec::new());
            return Ok(());
        }
        search.organizations = Some(keys);
        Ok(())
    }

    /// Имя организации → ключ справочника `orgs` (AD `company`), по убыванию
    /// точности: точное совпадение нормализованного ключа либо единственный
    /// справочник, взаимно содержащий ключ подстрокой. Нескольких кандидатов
    /// или нуля — имя не разрешается (`None`).
    fn resolve_org_key(conn: &Connection, name: &str) -> Result<Option<String>, AppError> {
        let key = crate::services::tokens::company_key(name);
        let exact: i64 = conn.query_row(
            "SELECT COUNT(*) FROM orgs WHERE name_key = ?1",
            [&key],
            |row| row.get(0),
        )?;
        if exact > 0 {
            return Ok(Some(key));
        }
        let mut stmt = conn.prepare(
            "SELECT name_key FROM orgs \
             WHERE instr(name_key, ?1) > 0 OR instr(?1, name_key) > 0",
        )?;
        let candidates: Vec<String> = stmt
            .query_map([&key], |row| row.get::<_, String>(0))?
            .filter_map(Result::ok)
            .collect();
        match candidates.as_slice() {
            [single] => Ok(Some(single.clone())),
            _ => Ok(None),
        }
    }

    /// Общее число совпадений FTS-запроса (без LIMIT).
    fn fts_count(
        conn: &Connection,
        match_expr: &str,
        search: &SearchParams,
    ) -> Result<u64, AppError> {
        let mut sql = format!(
            "SELECT COUNT(*) FROM users_fts \
             JOIN users ON users.object_guid = users_fts.object_guid \
             {LOOKUP_JOINS} WHERE users_fts MATCH ?"
        );
        let mut args: Vec<SqlValue> = vec![SqlValue::Text(match_expr.to_string())];
        push_filters(&mut sql, &mut args, search);
        push_empty_filter(&mut sql, search);
        Ok(query_scalar(conn, &sql, &args)? as u64)
    }

    /// Совпадения дополнения, которые FTS не нашёл (для точного общего числа).
    fn complement_only_count(
        conn: &Connection,
        conditions: &str,
        args: &[SqlValue],
        fts_expr: Option<&str>,
    ) -> Result<u64, AppError> {
        let mut sql = format!("SELECT COUNT(*) FROM users {LOOKUP_JOINS} WHERE {conditions}");
        let mut args = args.to_vec();
        if let Some(expr) = fts_expr {
            sql.push_str(
                " AND NOT EXISTS (SELECT 1 FROM users_fts WHERE users_fts.object_guid = users.object_guid AND users_fts MATCH ?)",
            );
            args.push(SqlValue::Text(expr.to_string()));
        }
        Ok(query_scalar(conn, &sql, &args)? as u64)
    }

    /// Общее число контактов по фильтрам (без запроса и LIMIT).
    fn browse_count(conn: &Connection, search: &SearchParams) -> Result<u64, AppError> {
        let mut sql = format!("SELECT COUNT(*) FROM users {LOOKUP_JOINS} WHERE 1=1");
        let mut args: Vec<SqlValue> = Vec::new();
        push_filters(&mut sql, &mut args, search);
        push_empty_filter(&mut sql, search);
        Ok(query_scalar(conn, &sql, &args)? as u64)
    }

    fn fts_search(
        conn: &Connection,
        match_expr: &str,
        search: &SearchParams,
        limit: i64,
    ) -> Result<Vec<Employee>, AppError> {
        let mut sql = format!(
            "SELECT {EMPLOYEE_COLUMNS} FROM users_fts \
             JOIN users ON users.object_guid = users_fts.object_guid \
             {LOOKUP_JOINS} WHERE users_fts MATCH ?"
        );
        let mut args: Vec<SqlValue> = vec![SqlValue::Text(match_expr.to_string())];
        push_filters(&mut sql, &mut args, search);
        push_empty_filter(&mut sql, search);
        // Веса bm25 по колонкам FTS: guid(0), ФИО, отдел, компания,
        // должность, e-mail, токены (инициалы/телефоны).
        sql.push_str(" ORDER BY bm25(users_fts, 0.0, 10.0, 2.0, 1.0, 2.0, 3.0, 6.0) LIMIT ?");
        args.push(SqlValue::Int(limit));

        query(conn, &sql, &args)
    }

    /// Условия дополнения к FTS: триграммный индекс для подстрок от 3
    /// символов (hay в нижнем регистре, phones только цифры) и LIKE для
    /// того, что триграммам недоступно (1–2 символа, двухзначные хвосты).
    /// `None` — дополнять нечем.
    fn complement_conditions(
        raw_query: &str,
        search: &SearchParams,
    ) -> Option<(String, Vec<SqlValue>)> {
        let text = raw_query.trim().to_lowercase();
        let digits: String = raw_query.chars().filter(|c| c.is_ascii_digit()).collect();

        let mut parts: Vec<String> = Vec::new();
        let mut args: Vec<SqlValue> = Vec::new();

        if text.chars().count() >= 3 {
            parts.push(
                "EXISTS (SELECT 1 FROM users_substr                  WHERE users_substr.object_guid = users.object_guid                  AND users_substr MATCH ?)"
                    .to_string(),
            );
            args.push(SqlValue::Text(fts_phrase("hay", &text)));
        }
        if digits.len() >= 3 {
            parts.push(
                "EXISTS (SELECT 1 FROM users_substr                  WHERE users_substr.object_guid = users.object_guid                  AND users_substr MATCH ?)"
                    .to_string(),
            );
            args.push(SqlValue::Text(fts_phrase("phones", &digits)));
        }
        if text.chars().count() < 3 {
            let pattern = format!("%{}%", escape_like(raw_query));
            for column in [
                "users.display_name",
                "users.email",
                "departments.name",
                "orgs.name",
                "users.title",
                "locations.name",
                "users.sam_account_name",
            ] {
                parts.push(format!("{column} LIKE ? ESCAPE '\\'"));
                args.push(SqlValue::Text(pattern.clone()));
            }
        }
        if digits.len() == 2 {
            // «Хвост» номера: сравниваем только цифры, игнорируя
            // форматирование («45-67» найдёт «+7 (495) 123-45-67»).
            let digit_pattern = format!("%{digits}%");
            for column in ["ip_phone", "phone_external", "phone_mobile"] {
                parts.push(format!("({}) LIKE ? ESCAPE '\\'", digits_sql(column)));
                args.push(SqlValue::Text(digit_pattern.clone()));
            }
        }

        if parts.is_empty() {
            return None;
        }
        let mut conditions = format!("({})", parts.join(" OR "));
        push_filters(&mut conditions, &mut args, search);
        push_empty_filter(&mut conditions, search);
        Some((conditions, args))
    }

    fn complement_search(
        conn: &Connection,
        conditions: &str,
        args: &[SqlValue],
        limit: i64,
    ) -> Result<Vec<Employee>, AppError> {
        let mut sql =
            format!("SELECT {EMPLOYEE_COLUMNS} FROM users {LOOKUP_JOINS} WHERE {conditions}");
        sql.push_str(ORDER_NAMES);
        sql.push_str(" LIMIT ?");
        let mut args = args.to_vec();
        args.push(SqlValue::Int(limit));
        query(conn, &sql, &args)
    }

    fn browse(
        conn: &Connection,
        search: &SearchParams,
        limit: i64,
    ) -> Result<Vec<Employee>, AppError> {
        let mut sql = format!("SELECT {EMPLOYEE_COLUMNS} FROM users {LOOKUP_JOINS} WHERE 1=1");
        let mut args: Vec<SqlValue> = Vec::new();
        push_filters(&mut sql, &mut args, search);
        push_empty_filter(&mut sql, search);
        sql.push_str(ORDER_NAMES);
        sql.push_str(" LIMIT ?");
        args.push(SqlValue::Int(limit));
        query(conn, &sql, &args)
    }

    fn by_ids(conn: &Connection, ids: &[String]) -> Result<Vec<Employee>, AppError> {
        let mut result = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(400) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "SELECT {EMPLOYEE_COLUMNS} FROM users {LOOKUP_JOINS} WHERE users.object_guid IN ({placeholders}) ORDER BY users.sort_key"
            );
            let args: Vec<SqlValue> = chunk.iter().map(|id| SqlValue::Text(id.clone())).collect();
            result.extend(query(conn, &sql, &args)?);
        }
        result.sort_by(|a, b| {
            let na = a.display_name.as_deref().unwrap_or_default();
            let nb = b.display_name.as_deref().unwrap_or_default();
            name_group(na)
                .cmp(&name_group(nb))
                .then_with(|| na.to_lowercase().cmp(&nb.to_lowercase()))
        });
        Ok(result)
    }

    /// Карточка сотрудника по GUID — точечная выборка для карточки контакта.
    pub fn get_by_id(&self, id: &str) -> Result<Employee, AppError> {
        let conn = self.lock();
        conn.query_row(
            &format!(
                "SELECT {EMPLOYEE_COLUMNS} FROM users {LOOKUP_JOINS} WHERE users.object_guid = ?1"
            ),
            [id],
            row_to_employee,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Контакт не найден в справочнике или был удалён".into()))
    }

    pub fn list_organizations(&self) -> Result<Vec<String>, AppError> {
        let conn = self.lock();
        // Дедупликацию вариантов написания («КМАруда», «КМАРУДА», лишние
        // пробелы) гарантирует UNIQUE-ключ справочника `orgs` — запрос
        // просто отдаёт отображаемые имена.
        let mut stmt = conn.prepare("SELECT name FROM orgs")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut orgs: Vec<String> = rows.filter_map(Result::ok).collect();
        orgs.sort_by(|a, b| {
            name_group(a)
                .cmp(&name_group(b))
                .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
        });
        Ok(orgs)
    }

    pub fn count(&self) -> Result<u64, AppError> {
        let conn = self.lock();
        Ok(conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get::<_, i64>(0))? as u64)
    }
}

/// Фильтр «не пустая учётка»: есть почта ИЛИ любой телефон.
/// Применяется ко всем путям поиска и к count-запросам.
fn push_empty_filter(sql: &mut String, search: &SearchParams) {
    if search.hide_empty {
        sql.push_str(
            " AND (users.email IS NOT NULL AND users.email != ''
               OR users.phone_mobile IS NOT NULL AND users.phone_mobile != ''
               OR users.ip_phone IS NOT NULL AND users.ip_phone != ''
               OR users.phone_external IS NOT NULL AND users.phone_external != '')",
        );
    }
}

fn push_filters(sql: &mut String, args: &mut Vec<SqlValue>, search: &SearchParams) {
    if let Some(org) = search
        .organization
        .as_deref()
        .map(str::trim)
        .filter(|o| !o.is_empty())
    {
        sql.push_str(" AND orgs.name_key = ?");
        args.push(SqlValue::Text(crate::services::tokens::company_key(org)));
    }
    // Союз организаций группы: ключи уже разрешены normalize_org_union;
    // company_key идемпотентен, поэтому повторная нормализация безопасна.
    if let Some(orgs) = search.organizations.as_deref() {
        if orgs.is_empty() {
            sql.push_str(" AND 0");
        } else {
            let placeholders = vec!["?"; orgs.len()].join(",");
            sql.push_str(&format!(" AND orgs.name_key IN ({placeholders})"));
            args.extend(
                orgs.iter()
                    .map(|org| SqlValue::Text(crate::services::tokens::company_key(org))),
            );
        }
    }
    if let Some(source_org) = search
        .source_org
        .as_deref()
        .map(str::trim)
        .filter(|o| !o.is_empty())
    {
        sql.push_str(" AND sources.name = ?");
        args.push(SqlValue::Text(source_org.to_string()));
    }
    if let Some(department) = search
        .department
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        sql.push_str(" AND departments.name = ?");
        args.push(SqlValue::Text(department.to_string()));
    }
}

fn query(conn: &Connection, sql: &str, args: &[SqlValue]) -> Result<Vec<Employee>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), row_to_employee)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// «Кириллица сначала»: служебные учётки и записи, начинающиеся с латиницы
/// (adm-, svc- и т.п.), не поднимаются в начало списка. Юникод: а=1072..я=1103, ё=1105.
const ORDER_NAMES: &str = " ORDER BY CASE WHEN unicode(substr(users.sort_key, 1, 1)) BETWEEN 1072 AND 1105 THEN 0 ELSE 1 END, users.sort_key";

/// Группа сортировки имени: 0 — начинается с кириллицы, 1 — прочее (латиница и т.д.).
fn name_group(name: &str) -> u8 {
    match name.chars().next() {
        Some('а'..='я' | 'ё' | 'А'..='Я' | 'Ё') => 0,
        _ => 1,
    }
}

fn query_scalar(conn: &Connection, sql: &str, args: &[SqlValue]) -> Result<i64, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query(params_from_iter(args.iter()))?;
    match rows.next()? {
        Some(row) => Ok(row.get::<_, i64>(0)?),
        None => Ok(0),
    }
}

fn row_to_employee(row: &Row<'_>) -> rusqlite::Result<Employee> {
    Ok(Employee {
        object_guid: row.get(0)?,
        source_org: row.get(1)?,
        sam_account_name: row.get(2)?,
        first_name: row.get(3)?,
        last_name: row.get(4)?,
        middle_name: row.get(5)?,
        display_name: row.get(6)?,
        title: row.get(7)?,
        department: row.get(8)?,
        company: row.get(9)?,
        office: row.get(10)?,
        email: row.get(11)?,
        ip_phone: row.get(12)?,
        phone_external: row.get(13)?,
        phone_mobile: row.get(14)?,
        manager: row.get(15)?,
        usn_changed: row.get(16)?,
        updated_at: row.get(17)?,
        pager: row.get(18)?,
    })
}

/// Экранирование спецсимволов LIKE (`\`, `%`, `_`).
pub(super) fn escape_like(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' | '%' | '_' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

/// SQL-выражение «только цифры» для телефонной колонки.
fn digits_sql(column: &str) -> String {
    format!(
        "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(users.{column}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')"
    )
}

/// FTS-фраза с фильтром по колонке: `column : "значение"` (кавычки внутри
/// значения удваиваются). Значение обязано быть преднормализовано так же,
/// как содержимое индекса (hay — lower, phones — цифры).
fn fts_phrase(column: &str, value: &str) -> String {
    let escaped = value.replace('"', "\"\"");
    format!("{column} : \"{escaped}\"")
}
