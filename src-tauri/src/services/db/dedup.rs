//! Cleanup of duplicate accounts in the cache.
//!
//! Duplicates arise when one employee is present in several
//! sync sources (different AD connections of the holding) or when the catalog
//! has a second account of the same person: their `object_guid` values differ, so
//! a normal replace by source does not collapse them.
//!
//! Duplicate rule (agreed with the product owner): matches
//! normalized display name AND at least one contact
//! key (email, mobile digits, internal number digits, login).
//! Clusters within one name are built with union-find by intersection of
//! contact keys: chains "A matched B, B matched C" are merged.
//!
//! The kept record is the most "filled" one (more non-empty fields),
//! on a tie - by pager (TrueConf ID), then by the smaller GUID:
//! deterministic choice without manual confirmations for each pair.

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;

use super::Db;

/// How many removable record names the preview returns. The dialog shows all
/// of them when there are at most seven records, otherwise it lists the first
/// six and collapses the rest into a counter.
const PREVIEW_NAME_LIMIT: usize = 7;

/// Duplicate cluster: who we keep and who we remove.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    /// Cluster display name.
    pub display_name: String,
    /// GUID of the kept record.
    pub keep_guid: String,
    /// GUIDs of the removed records.
    pub remove_guids: Vec<String>,
    /// Display names of the removed records (whitespace normalized).
    pub remove_names: Vec<String>,
}

/// Summary for the settings preview: numbers and the names of records that
/// will actually be deleted.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatesPreview {
    /// How many duplicate clusters were found.
    pub groups: usize,
    /// How many records will be deleted in total.
    pub removable: usize,
    /// Names of the first removable records (for the confirmation dialog).
    pub removable_names: Vec<String>,
}

/// Raw row for duplicate search.
struct RawRow {
    object_guid: String,
    display_name: String,
    contact_keys: Vec<String>,
    fill_score: u32,
    has_pager: bool,
}

/// Name normalization: lowercase, collapsed whitespace.
fn name_key(value: &str) -> String {
    crate::services::tokens::collapse_spaces(value).to_lowercase()
}

/// Phone digits: comparison regardless of formatting.
fn digits(value: &str) -> String {
    value.chars().filter(|c| c.is_ascii_digit()).collect()
}

impl Db {
    /// Duplicate clusters of the current cache (empty - nothing to remove).
    /// Not needed outside the module: the [`DuplicatesPreview`] summary is exposed.
    pub(crate) fn find_duplicates(&self) -> Result<Vec<DuplicateGroup>, AppError> {
        let conn = self.lock();
        let rows = Self::duplicate_rows(&conn)?;
        drop(conn);
        Ok(cluster_duplicates(rows))
    }

    /// Summary for the settings preview.
    pub fn duplicates_preview(&self) -> Result<DuplicatesPreview, AppError> {
        let groups = self.find_duplicates()?;
        let removable = groups.iter().map(|g| g.remove_guids.len()).sum();
        let removable_names = groups
            .iter()
            .flat_map(|g| g.remove_names.iter().cloned())
            .take(PREVIEW_NAME_LIMIT)
            .collect();
        Ok(DuplicatesPreview {
            groups: groups.len(),
            removable,
            removable_names,
        })
    }

    /// Remove duplicates: delete the removable records, clean the indexes and
    /// orphaned lookups, and resave the container. Returns the number of
    /// deleted records.
    pub fn deduplicate(&self) -> Result<usize, AppError> {
        let groups = self.find_duplicates()?;
        let guids: Vec<String> = groups.iter().flat_map(|g| g.remove_guids.clone()).collect();
        if guids.is_empty() {
            return Ok(0);
        }
        let removed = guids.len();
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        for chunk in guids.chunks(400) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            tx.execute(
                &format!("DELETE FROM users WHERE object_guid IN ({placeholders})"),
                rusqlite::params_from_iter(chunk),
            )?;
        }
        tx.execute_batch(
            "DELETE FROM users_fts WHERE object_guid NOT IN (SELECT object_guid FROM users);
             DELETE FROM users_substr WHERE object_guid NOT IN (SELECT object_guid FROM users);
             DELETE FROM departments WHERE id NOT IN
                 (SELECT department_id FROM users WHERE department_id IS NOT NULL);
             DELETE FROM locations WHERE id NOT IN
                 (SELECT location_id FROM users WHERE location_id IS NOT NULL);
             DELETE FROM orgs WHERE id NOT IN
                 (SELECT org_id FROM users WHERE org_id IS NOT NULL);",
        )?;
        tx.commit()?;
        drop(conn);
        self.flush()?;
        Ok(removed)
    }

    /// Rows for duplicate clustering. External phone
    /// files do not participate: their identifiers are synthetic, and a "duplicate"
    /// with an AD employee - a legitimate number complement, not junk.
    fn duplicate_rows(conn: &Connection) -> Result<Vec<RawRow>, AppError> {
        let mut stmt = conn.prepare(
            "SELECT users.object_guid, users.display_name, users.email, users.ip_phone, \
                    users.phone_external, users.phone_mobile, users.sam_account_name, \
                    users.title, users.department_id, users.pager \
             FROM users JOIN sources ON sources.id = users.source_id \
             WHERE sources.kind = 'ad'",
        )?;
        let mapped = stmt.query_map([], |row| {
            let guid: String = row.get(0)?;
            let display: String = row.get(1)?;
            let email: Option<String> = row.get(2)?;
            let ip: Option<String> = row.get(3)?;
            let external: Option<String> = row.get(4)?;
            let mobile: Option<String> = row.get(5)?;
            let sam: Option<String> = row.get(6)?;
            let title: Option<String> = row.get(7)?;
            let department_id: Option<i64> = row.get(8)?;
            let pager: Option<String> = row.get(9)?;

            let mut contact_keys = Vec::new();
            if let Some(email) = email.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                contact_keys.push(format!("m:{email}", email = email.to_lowercase()));
            }
            for (tag, value) in [
                ("mob", mobile.as_deref()),
                ("ip", ip.as_deref()),
                ("ext", external.as_deref()),
            ] {
                if let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) {
                    let digits = digits(value);
                    if !digits.is_empty() {
                        contact_keys.push(format!("{tag}:{digits}"));
                    }
                }
            }
            if let Some(sam) = sam.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                contact_keys.push(format!("s:{}", sam.to_lowercase()));
            }

            let fill_score = [
                email.as_deref(),
                ip.as_deref(),
                external.as_deref(),
                mobile.as_deref(),
                sam.as_deref(),
                title.as_deref(),
                pager.as_deref(),
            ]
            .iter()
            .filter(|v| v.map(|s| !s.trim().is_empty()).unwrap_or(false))
            .count() as u32
                + u32::from(department_id.is_some());

            Ok(RawRow {
                object_guid: guid,
                display_name: display,
                contact_keys,
                fill_score,
                has_pager: pager.as_deref().is_some_and(|p| !p.trim().is_empty()),
            })
        })?;
        let rows: Vec<RawRow> = mapped.collect::<Result<_, _>>()?;
        Ok(rows)
    }
}

/// Clustering: within one normalized name we merge records
/// with intersecting contact keys (union-find).
fn cluster_duplicates(rows: Vec<RawRow>) -> Vec<DuplicateGroup> {
    use std::collections::HashMap;

    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, row) in rows.iter().enumerate() {
        by_name
            .entry(name_key(&row.display_name))
            .or_default()
            .push(index);
    }

    let mut groups = Vec::new();
    for indices in by_name.values().filter(|indices| indices.len() > 1) {
        let mut parent: Vec<usize> = (0..indices.len()).collect();
        fn find(parent: &mut [usize], mut i: usize) -> usize {
            while parent[i] != i {
                parent[i] = parent[parent[i]];
                i = parent[i];
            }
            i
        }
        for a in 0..indices.len() {
            for b in (a + 1)..indices.len() {
                let keys_a = &rows[indices[a]].contact_keys;
                let keys_b = &rows[indices[b]].contact_keys;
                let intersects = keys_a.iter().any(|key| keys_b.contains(key));
                if intersects {
                    let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
                    if ra != rb {
                        parent[rb] = ra;
                    }
                }
            }
        }
        let mut clusters: HashMap<usize, Vec<usize>> = HashMap::new();
        for i in 0..indices.len() {
            clusters.entry(find(&mut parent, i)).or_default().push(i);
        }
        for members in clusters.values().filter(|members| members.len() > 1) {
            let mut members = members.clone();
            members.sort_by(|a, b| {
                let row_a = &rows[indices[*a]];
                let row_b = &rows[indices[*b]];
                row_b
                    .fill_score
                    .cmp(&row_a.fill_score)
                    .then(row_b.has_pager.cmp(&row_a.has_pager))
                    .then(row_a.object_guid.cmp(&row_b.object_guid))
            });
            let keep = indices[members[0]];
            let removed = &members[1..];
            let remove_guids = removed
                .iter()
                .map(|i| rows[indices[*i]].object_guid.clone())
                .collect();
            let remove_names = removed
                .iter()
                .map(|i| crate::services::tokens::collapse_spaces(&rows[indices[*i]].display_name))
                .collect();
            groups.push(DuplicateGroup {
                display_name: rows[keep].display_name.clone(),
                keep_guid: rows[keep].object_guid.clone(),
                remove_guids,
                remove_names,
            });
        }
    }
    groups.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::db::UserRecord;

    fn record(guid: &str, display: &str) -> UserRecord {
        UserRecord {
            object_guid: guid.into(),
            sam_account_name: None,
            first_name: None,
            last_name: None,
            middle_name: None,
            display_name: display.into(),
            sort_key: display.to_lowercase(),
            title: None,
            department: None,
            company: None,
            office: None,
            email: None,
            ip_phone: None,
            phone_external: None,
            phone_mobile: None,
            manager: None,
            manager_guid: None,
            pager: None,
            usn_changed: None,
            tokens: String::new(),
            photo: None,
        }
    }

    #[test]
    fn same_name_plus_shared_contact_is_duplicate() {
        let db = Db::open_in_memory().expect("db");
        let mut a = record("g1", "Иванов Иван");
        a.email = Some("ivanov@kmaruda.ru".into());
        a.ip_phone = Some("1234".into());
        let mut b = record("g2", "Иванов  Иван"); // whitespace does not help
        b.email = Some("IVANOV@kmaruda.ru".into()); // case does not help
        b.phone_mobile = Some("999 111 22 33".into());
        db.replace_org_users("Орг", &[a, b]).expect("sync");

        let preview = db.duplicates_preview().expect("preview");
        assert_eq!(preview.groups, 1);
        assert_eq!(preview.removable, 1);
        assert_eq!(preview.removable_names, vec!["Иванов Иван".to_string()]);

        // The kept one is the one with more filling (g1 has email + ip, g2 has email + mobile:
        // scores are equal, then GUID is compared: g1 is smaller).
        let groups = db.find_duplicates().expect("groups");
        assert_eq!(groups[0].keep_guid, "g1");
        assert_eq!(groups[0].remove_guids, vec!["g2".to_string()]);

        assert_eq!(db.deduplicate().expect("dedup"), 1);
        assert_eq!(db.count().expect("count"), 1);
        assert_eq!(
            db.duplicates_preview().expect("preview").groups,
            0,
            "повторный прогон не находит дубликатов"
        );
    }

    #[test]
    fn same_name_without_shared_contacts_is_not_duplicate() {
        let db = Db::open_in_memory().expect("db");
        let mut a = record("g1", "Иванов Иван");
        a.email = Some("one@kmaruda.ru".into());
        let mut b = record("g2", "Иванов Иван");
        b.email = Some("two@kmaruda.ru".into());
        db.replace_org_users("Орг", &[a, b]).expect("sync");
        assert_eq!(db.duplicates_preview().expect("preview").groups, 0);
    }

    #[test]
    fn chain_of_shared_keys_glues_cluster() {
        let db = Db::open_in_memory().expect("db");
        let mut a = record("g1", "Петров Пётр");
        a.ip_phone = Some("1111".into());
        let mut b = record("g2", "Петров Пётр");
        b.ip_phone = Some("1111".into());
        b.phone_mobile = Some("9991112233".into());
        let mut c = record("g3", "Петров Пётр");
        c.phone_mobile = Some("999-111-22-33".into()); // same digits, different format
        db.replace_org_users("Орг", &[a, b, c]).expect("sync");

        let groups = db.find_duplicates().expect("groups");
        assert_eq!(groups.len(), 1, "цепочка g1-g2-g3 — один кластер");
        assert_eq!(groups[0].remove_guids.len(), 2);
    }

    #[test]
    fn preview_lists_removable_names_up_to_limit() {
        let db = Db::open_in_memory().expect("db");
        let mut users = Vec::new();
        for i in 0..8 {
            let name = format!("User {i}");
            let mut keep = record(&format!("k{i}"), &name);
            keep.email = Some(format!("u{i}@example.com"));
            let mut removed = record(&format!("r{i}"), &name);
            removed.email = Some(format!("u{i}@example.com"));
            users.push(keep);
            users.push(removed);
        }
        db.replace_org_users("Org", &users).expect("sync");

        let preview = db.duplicates_preview().expect("preview");
        assert_eq!(preview.groups, 8);
        assert_eq!(preview.removable, 8);
        assert_eq!(preview.removable_names.len(), PREVIEW_NAME_LIMIT);
        assert_eq!(preview.removable_names[0], "User 0");
        assert_eq!(preview.removable_names[PREVIEW_NAME_LIMIT - 1], "User 6");
    }
}
