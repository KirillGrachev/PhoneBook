//! Уборка дубликатов учётных записей в кэше.
//!
//! Дубликаты возникают, когда один сотрудник присутствует в нескольких
//! источниках синхронизации (разные AD-подключения холдинга) или в каталоге
//! есть вторая учётка того же человека: `object_guid` у них разные, поэтому
//! обычный replace по источнику их не схлопывает.
//!
//! Правило дубликата (согласовано с владельцем продукта): совпадает
//! нормализованное отображаемое имя И совпадает хотя бы один контактный
//! ключ (e-mail, цифры мобильного, цифры внутреннего номера, логин).
//! Кластеры внутри одного имени строятся union-find по пересечению
//! контактных ключей: цепочки «A совпал с B, B с C» склеиваются.
//!
//! Оставляемая запись — самая «заполненная» (больше непустых полей),
//! при равенстве — с пейджером (TrueConf ID), затем с меньшим GUID:
//! детерминированный выбор без ручных подтверждений по каждой паре.

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;

use super::Db;

/// Кластер дубликатов: кого оставляем и кого убираем.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    /// Отображаемое имя кластера.
    pub display_name: String,
    /// GUID оставляемой записи.
    pub keep_guid: String,
    /// GUID убираемых записей.
    pub remove_guids: Vec<String>,
}

/// Сводка для превью в настройках: числа и примеры имён.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatesPreview {
    /// Сколько кластеров дубликатов найдено.
    pub groups: usize,
    /// Сколько записей будет удалено суммарно.
    pub removable: usize,
    /// Имена первых кластеров (для подтверждающего диалога).
    pub samples: Vec<String>,
}

/// Сырая строка для поиска дубликатов.
struct RawRow {
    object_guid: String,
    display_name: String,
    contact_keys: Vec<String>,
    fill_score: u32,
    has_pager: bool,
}

/// Нормализация имени: нижний регистр, схлопнутые пробелы.
fn name_key(value: &str) -> String {
    crate::services::tokens::collapse_spaces(value).to_lowercase()
}

/// Цифры телефона: сравнение независимо от форматирования.
fn digits(value: &str) -> String {
    value.chars().filter(|c| c.is_ascii_digit()).collect()
}

impl Db {
    /// Кластеры дубликатов текущего кэша (пусто — убирать нечего).
    /// Вне модуля не нужен: наружу отдаётся сводка [`DuplicatesPreview`].
    pub(crate) fn find_duplicates(&self) -> Result<Vec<DuplicateGroup>, AppError> {
        let conn = self.lock();
        let rows = Self::duplicate_rows(&conn)?;
        drop(conn);
        Ok(cluster_duplicates(rows))
    }

    /// Сводка для превью в настройках.
    pub fn duplicates_preview(&self) -> Result<DuplicatesPreview, AppError> {
        let groups = self.find_duplicates()?;
        let removable = groups.iter().map(|g| g.remove_guids.len()).sum();
        let samples = groups
            .iter()
            .take(5)
            .map(|g| g.display_name.clone())
            .collect();
        Ok(DuplicatesPreview {
            groups: groups.len(),
            removable,
            samples,
        })
    }

    /// Убрать дубликаты: удалить убираемые записи, почистить индексы и
    /// осиротевшие справочники, пересохранить контейнер. Возвращает число
    /// удалённых записей.
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

    fn duplicate_rows(conn: &Connection) -> Result<Vec<RawRow>, AppError> {
        let mut stmt = conn.prepare(
            "SELECT object_guid, display_name, email, ip_phone, phone_external, \
                    phone_mobile, sam_account_name, title, department_id, pager \
             FROM users",
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

/// Кластеризация: внутри одного нормализованного имени склеиваем записи
/// с пересекающимися контактными ключами (union-find).
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
            let remove_guids = members[1..]
                .iter()
                .map(|i| rows[indices[*i]].object_guid.clone())
                .collect();
            groups.push(DuplicateGroup {
                display_name: rows[keep].display_name.clone(),
                keep_guid: rows[keep].object_guid.clone(),
                remove_guids,
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
            pager: None,
            usn_changed: None,
            tokens: String::new(),
        }
    }

    #[test]
    fn same_name_plus_shared_contact_is_duplicate() {
        let db = Db::open_in_memory().expect("db");
        let mut a = record("g1", "Иванов Иван");
        a.email = Some("ivanov@kmaruda.ru".into());
        a.ip_phone = Some("1234".into());
        let mut b = record("g2", "Иванов  Иван"); // пробелы не спасают
        b.email = Some("IVANOV@kmaruda.ru".into()); // регистр не спасает
        b.phone_mobile = Some("999 111 22 33".into());
        db.replace_org_users("Орг", &[a, b]).expect("sync");

        let preview = db.duplicates_preview().expect("preview");
        assert_eq!(preview.groups, 1);
        assert_eq!(preview.removable, 1);
        assert_eq!(preview.samples, vec!["Иванов Иван".to_string()]);

        // Оставляемая — с большим заполнением (у g1 email + ip, у g2 email + mobile:
        // счёт равный, далее сравнивается GUID: g1 меньше).
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
        c.phone_mobile = Some("999-111-22-33".into()); // те же цифры, другой формат
        db.replace_org_users("Орг", &[a, b, c]).expect("sync");

        let groups = db.find_duplicates().expect("groups");
        assert_eq!(groups.len(), 1, "цепочка g1-g2-g3 — один кластер");
        assert_eq!(groups[0].remove_guids.len(), 2);
    }
}
