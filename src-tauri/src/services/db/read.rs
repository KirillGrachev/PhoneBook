//! Read queries: search (FTS5 + LIKE fallback), counters, selections.

use std::sync::atomic::Ordering;

use rusqlite::{params_from_iter, Connection, OptionalExtension, Row, ToSql};

use crate::error::AppError;

use super::model::{AdDuplicateRecord, Employee, SearchPage, SearchParams};
use super::schema::{EMPLOYEE_COLUMNS, LOOKUP_JOINS};
use super::Db;

/// Dynamic SQL parameter value.
///
/// The number of parameters depends on the query, while `params_from_iter` requires
/// `Item: ToSql`. Our own wrapper makes heterogeneous parameter sets
/// type-safe and does not rely on subtleties of rusqlite trait-object impls.
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
        // requestId is only for cancelling stale requests, it does not affect the result
        // affects it; otherwise every new id would miss the cache.
        let mut cache_params = search.clone();
        cache_params.request_id = None;
        let cache_key = (self.search_generation.load(Ordering::SeqCst), cache_params);
        if let Ok(cache) = self.search_cache.lock() {
            if let Some(page) = cache.get(&cache_key) {
                return Ok(page);
            }
        }

        let page = match self.checkout_read() {
            Some(reader) => {
                let fallback = search.clone();
                let result = self.search_locked(&reader, search);
                self.return_read(reader);
                match result {
                    Ok(page) => page,
                    // A shared-cache reader might not see the schema (e.g.,
                    // after deserialize): repeat on the main connection.
                    Err(AppError::Db(_)) => {
                        let conn = self.lock();
                        self.search_locked(&conn, fallback)?
                    }
                    Err(error) => return Err(error),
                }
            }
            None => {
                let conn = self.lock();
                self.search_locked(&conn, search)?
            }
        };

        if page.items.len() <= 500 {
            if let Ok(mut cache) = self.search_cache.lock() {
                cache.put(cache_key, page.clone());
            }
        }
        Ok(page)
    }

    fn search_locked(
        &self,
        conn: &Connection,
        search: SearchParams,
    ) -> Result<SearchPage, AppError> {
        let mut search = search;
        Self::normalize_org_filter(conn, &mut search)?;
        // The upper bound protects IPC/memory from a "whole database" request;
        // 0 no longer means "no limit" — it is just the default page.
        let limit = i64::from(search.limit.unwrap_or(300).clamp(1, 10_000));
        let offset = i64::from(search.offset.unwrap_or(0));

        if let Some(ids) = search.ids.as_ref().filter(|ids| !ids.is_empty()) {
            let all = Self::by_ids(conn, ids)?;
            let total = all.len() as u64;
            let skip = usize::try_from(offset).unwrap_or(usize::MAX);
            let items: Vec<_> = all.into_iter().skip(skip).take(limit as usize).collect();
            return Ok(SearchPage { items, total });
        }

        // Layout variants are built from the RAW query: a comma and a period
        // on the Russian layout these are "b" and "yu", and sanitizing before them would deprive
        // search for these letters. The sanitized string is needed only for trigram
        // index and LIKE (hay has no punctuation); if layout variants
        // none at all (e.g. "%"), the query degrades to a browse.
        let raw_query = search
            .query
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty());
        let (items, total) = if let Some(raw) = raw_query {
            let match_expr = crate::services::tokens::build_fts_query(raw);
            if let Some(expr) = match_expr.as_deref() {
                let san: String = raw
                    .chars()
                    .filter(|c| c.is_alphanumeric() || c.is_whitespace())
                    .collect::<String>()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ");
                let fts_total = Self::fts_count(conn, expr, &search)?;
                let mut total = fts_total;

                // The complement is only those substrings that are not in FTS.
                // Otherwise, when gluing two results, the same contact could
                // land on both the FTS page and the complement page.
                if let Some((conditions, args)) = Self::complement_conditions(&san, &search) {
                    let (only_conditions, only_args) = Self::exclude_fts(&conditions, &args, expr);
                    let complement_total =
                        Self::complement_only_count(conn, &only_conditions, &only_args)?;
                    total += complement_total;

                    // Result order: first all FTS matches (bm25), then
                    // complement-only (by name). Under this contract offset
                    // split into two parts without overlaps or gaps.
                    if offset < fts_total as i64 {
                        let mut page = Self::fts_search(conn, expr, &search, limit, offset)?;
                        if (page.len() as i64) < limit {
                            let need = limit - page.len() as i64;
                            let mut extra = Self::complement_search(
                                conn,
                                &only_conditions,
                                &only_args,
                                need,
                                0,
                            )?;
                            page.append(&mut extra);
                        }
                        (page, total)
                    } else {
                        let complement_offset = offset - fts_total as i64;
                        let page = Self::complement_search(
                            conn,
                            &only_conditions,
                            &only_args,
                            limit,
                            complement_offset,
                        )?;
                        (page, total)
                    }
                } else {
                    let page = Self::fts_search(conn, expr, &search, limit, offset)?;
                    (page, total)
                }
            } else {
                let total = Self::browse_count(conn, &search)?;
                let items = Self::browse(conn, &search, limit, offset)?;
                (items, total)
            }
        } else {
            let total = Self::browse_count(conn, &search)?;
            let items = Self::browse(conn, &search, limit, offset)?;
            (items, total)
        };
        Ok(SearchPage { items, total })
    }

    /// Binds the `organization` / `organizations` filters to the lookup
    /// `orgs` (AD `company`).
    ///
    /// The organization name from the AD connection settings may not match character-by-character
    /// with the `company` attribute value ("KMAruda" <-> "AO Kombinat KMAruda"),
    /// and the enterprise tab must search specifically by enterprise, not by
    /// the whole sync source (one domain may hold the entire holding).
    /// `organizations` - union of the filter group names from settings: each name is
    /// resolved independently; results consider the union (see
    /// [`Self::normalize_org_union`]).
    /// Name resolution, in descending accuracy:
    /// * an exact normalized key match - the normal filter path;
    /// * the single lookup mutually containing the key as a substring;
    /// * fallback to the sync source with the same name - only when
    ///   `source_org` is duplicated with the same value and there are no such organizations:
    ///   the enterprise tab degrades to "the whole source", but does not become empty.
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
            // An exact key match is a normal filter path.
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

    /// Resolves organization group names into `orgs` lookup keys.
    ///
    /// Each name is resolved independently ([`Self::resolve_org_key`]); the union
    /// keys go into the `IN (...)` result filter. Unresolved names
    /// are not included in the union. If no name was resolved:
    /// * a pair with non-empty `source_org` (enterprise tab marker) -
    ///   fallback to the sync source; the list does not become empty;
    /// * a strict group (without the marker) - `Some(vec![])`: results are empty,
    /// not "the whole holding": group organizations that disappeared from AD
    /// must not replace the filter with the absence of a filter.
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

    /// Organization name -> `orgs` lookup key (AD `company`), in descending
    /// accuracy: an exact normalized key match or the single
    /// lookup mutually containing the key as a substring. Several candidates
    /// or zero - the name is not resolved (`None`).
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

    /// Total number of FTS query matches (without LIMIT).
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

    /// Adds an exclusion of FTS matches to the complement conditions.
    ///
    /// NOT IN with subquery materialization: MATCH runs once
    /// (EXPLAIN: LIST SUBQUERY), not for every users row, as in
    /// correlated NOT EXISTS. `object_guid` in users_fts is always filled
    /// (insert from users.object_guid, PK), while IS NOT NULL guards against
    /// three-valued NOT IN logic.
    fn exclude_fts(conditions: &str, args: &[SqlValue], fts_expr: &str) -> (String, Vec<SqlValue>) {
        let mut conditions = conditions.to_string();
        conditions.push_str(
            " AND users.object_guid NOT IN (SELECT object_guid FROM users_fts WHERE users_fts MATCH ? AND object_guid IS NOT NULL)",
        );
        let mut args = args.to_vec();
        args.push(SqlValue::Text(fts_expr.to_string()));
        (conditions, args)
    }

    /// Complement matches that FTS did not find (for the exact total count).
    /// The conditions must already contain [`Self::exclude_fts`].
    fn complement_only_count(
        conn: &Connection,
        conditions: &str,
        args: &[SqlValue],
    ) -> Result<u64, AppError> {
        let sql = format!("SELECT COUNT(*) FROM users {LOOKUP_JOINS} WHERE {conditions}");
        Ok(query_scalar(conn, &sql, args)? as u64)
    }

    /// Total number of contacts by filters (without query and LIMIT).
    fn browse_count(conn: &Connection, search: &SearchParams) -> Result<u64, AppError> {
        // Without filters the JOINs are not needed: on 50k this is noticeably cheaper.
        let unfiltered = search.organization.is_none()
            && search.organizations.is_none()
            && search.source_org.is_none()
            && search.department.is_none()
            && search.title.is_none()
            && search.office.is_none()
            && search.ids.is_none()
            && !search.hide_empty;
        if unfiltered {
            return Ok(query_scalar(conn, "SELECT COUNT(*) FROM users", &[])? as u64);
        }

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
        offset: i64,
    ) -> Result<Vec<Employee>, AppError> {
        let mut sql = format!(
            "SELECT {EMPLOYEE_COLUMNS} FROM users_fts \
             JOIN users ON users.object_guid = users_fts.object_guid \
             {LOOKUP_JOINS} WHERE users_fts MATCH ?"
        );
        let mut args: Vec<SqlValue> = vec![SqlValue::Text(match_expr.to_string())];
        push_filters(&mut sql, &mut args, search);
        push_empty_filter(&mut sql, search);
        // bm25 weights by FTS columns: guid(0), name, department, company,
        // job title, email, tokens (initials/phone numbers).
        // GUID is a deterministic tie-break: without it identical bm25
        // could change order between pages and break offset pagination.
        sql.push_str(
            " ORDER BY bm25(users_fts, 0.0, 10.0, 2.0, 1.0, 2.0, 3.0, 6.0), users.object_guid LIMIT ? OFFSET ?",
        );
        args.push(SqlValue::Int(limit));
        args.push(SqlValue::Int(offset));

        query(conn, &sql, &args)
    }

    /// FTS complement conditions: trigram index for substrings of 3
    /// characters (hay in lowercase, phones digits only) and LIKE for
    /// what trigrams cannot access (1-2 characters, two-digit tails).
    /// `None` - nothing to complement with.
    fn complement_conditions(
        raw_query: &str,
        search: &SearchParams,
    ) -> Option<(String, Vec<SqlValue>)> {
        let text = raw_query.trim().to_lowercase();
        let digits: String = raw_query.chars().filter(|c| c.is_ascii_digit()).collect();

        let mut parts: Vec<String> = Vec::new();
        let mut args: Vec<SqlValue> = Vec::new();

        if text.chars().count() >= 3 {
            // IN with subquery materialization: MATCH runs once,
            // rather than for every users row (correlated EXISTS).
            parts.push(
                "users.object_guid IN (SELECT object_guid FROM users_substr WHERE users_substr MATCH ?)"
                    .to_string(),
            );
            args.push(SqlValue::Text(fts_phrase("hay", &text)));
        }
        if digits.len() >= 3 {
            parts.push(
                "users.object_guid IN (SELECT object_guid FROM users_substr WHERE users_substr MATCH ?)"
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
            // The number "tail": we compare only digits, ignoring
            // formatting ("45-67" finds "+7 (495) 123-45-67").
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
        offset: i64,
    ) -> Result<Vec<Employee>, AppError> {
        let mut sql =
            format!("SELECT {EMPLOYEE_COLUMNS} FROM users {LOOKUP_JOINS} WHERE {conditions}");
        sql.push_str(ORDER_NAMES);
        sql.push_str(" LIMIT ? OFFSET ?");
        let mut args = args.to_vec();
        args.push(SqlValue::Int(limit));
        args.push(SqlValue::Int(offset));
        query(conn, &sql, &args)
    }

    fn browse(
        conn: &Connection,
        search: &SearchParams,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Employee>, AppError> {
        let mut sql = format!("SELECT {EMPLOYEE_COLUMNS} FROM users {LOOKUP_JOINS} WHERE 1=1");
        let mut args: Vec<SqlValue> = Vec::new();
        push_filters(&mut sql, &mut args, search);
        push_empty_filter(&mut sql, search);
        sql.push_str(ORDER_NAMES);
        sql.push_str(" LIMIT ? OFFSET ?");
        args.push(SqlValue::Int(limit));
        args.push(SqlValue::Int(offset));
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

    /// Employee card by GUID - a point selection for the contact card.
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

    /// Raw avatar bytes for a single contact (AD `thumbnailPhoto`).
    /// `None` when the contact has no photo or does not exist; the frontend
    /// then renders a letter avatar. Kept separate from [`Employee`] so search
    /// pages never carry image payloads.
    pub fn get_photo(&self, id: &str) -> Result<Option<Vec<u8>>, AppError> {
        let conn = self.lock();
        conn.query_row(
            "SELECT photo FROM users WHERE object_guid = ?1",
            [id],
            |row| row.get::<_, Option<Vec<u8>>>(0),
        )
        .optional()
        .map(|row| row.flatten())
        .map_err(AppError::from)
    }

    /// Source type by name (`Some("ad"` / `Some("external")`): an external
    /// file must not occupy the name of a source that is synced with AD.
    pub fn source_kind(&self, name: &str) -> Result<Option<String>, AppError> {
        let conn = self.lock();
        conn.query_row(
            "SELECT kind FROM sources WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn list_organizations(&self) -> Result<Vec<String>, AppError> {
        let conn = self.lock();
        // Deduplication of spelling variants ("KMAruda", "KMARUDA", extra
        // whitespace) is guaranteed by the UNIQUE key of the `orgs` lookup - the query
        // simply returns the display names.
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

    /// AD contacts for cutting off external phone book duplicates: full name and
    /// contacts/attributes that can prove the record already exists in AD.
    pub fn ad_duplicates(&self) -> Result<Vec<AdDuplicateRecord>, AppError> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT users.display_name, users.title, departments.name, orgs.name, locations.name,
                    users.email, users.ip_phone, users.phone_external, users.phone_mobile
             FROM users
             JOIN sources ON sources.id = users.source_id
             LEFT JOIN departments ON departments.id = users.department_id
             LEFT JOIN orgs ON orgs.id = users.org_id
             LEFT JOIN locations ON locations.id = users.location_id
             WHERE sources.kind = 'ad'",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AdDuplicateRecord {
                display_name: row.get(0)?,
                title: row.get(1)?,
                department: row.get(2)?,
                company: row.get(3)?,
                office: row.get(4)?,
                email: row.get(5)?,
                ip_phone: row.get(6)?,
                phone_external: row.get(7)?,
                phone_mobile: row.get(8)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Number of users currently cached from external phone book sources.
    pub fn external_count(&self) -> Result<usize, AppError> {
        let conn = self.lock();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM users
             JOIN sources ON sources.id = users.source_id
             WHERE sources.kind = 'external'",
            [],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }
}

/// "Non-empty account" filter: has email OR any phone.
/// Applied to all search paths and to count queries.
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
    // Organization union of the group: keys are already resolved by normalize_org_union;
    // company_key is idempotent, so repeated normalization is safe.
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
    // Job title: an exact match (clicking a title in the card opens
    // list of people with the same job title - analogous to the department modal).
    if let Some(title) = search
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        sql.push_str(" AND users.title = ?");
        args.push(SqlValue::Text(title.to_string()));
    }
    // Office: an exact match (clicking an office in the card opens
    // list of people in the same office - the same logic as department/job title).
    if let Some(office) = search
        .office
        .as_deref()
        .map(str::trim)
        .filter(|o| !o.is_empty())
    {
        sql.push_str(" AND locations.name = ?");
        args.push(SqlValue::Text(office.to_string()));
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

/// "Cyrillic first": service accounts and records starting with Latin letters
/// (adm-, svc-, etc.) are not raised to the top of the list. Unicode: a=1072..ya=1103, yo=1105.
// A deterministic order for paginated results: sorting by name
// supplemented by a GUID tie-break; otherwise pages could get shuffled
// with identical sort_key.
const ORDER_NAMES: &str = " ORDER BY CASE WHEN unicode(substr(users.sort_key, 1, 1)) BETWEEN 1072 AND 1105 THEN 0 ELSE 1 END, users.sort_key, users.object_guid";

/// Name sort group: 0 - starts with Cyrillic, 1 - other (Latin, etc.).
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
        manager_guid: row.get(19)?,
    })
}

/// Escaping LIKE special characters (`\`, `%`, `_`).
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

/// SQL "digits only" expression for the phone column.
fn digits_sql(column: &str) -> String {
    format!(
        "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(users.{column}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')"
    )
}

/// FTS phrase with a column filter: `column : "value"` (quotes inside
/// values are doubled). The value must be pre-normalized the same way,
/// as the index content (hay - lower, phones - digits).
fn fts_phrase(column: &str, value: &str) -> String {
    let escaped = value.replace('"', "\"\"");
    format!("{column} : \"{escaped}\"")
}
