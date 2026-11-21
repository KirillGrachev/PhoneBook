//! Внешний телефонный файл (Yealink IPPhoneBook): подгрузка XML в справочник.
//!
//! В холдинге часть номеров живёт не в Active Directory, а в выгрузке
//! телефонной книги Yealink (`IPPhoneBook/Menu/Unit`). Файл подключается в
//! настройках (путь и признак хранятся в `config.json`) и загружается в локальный
//! кэш отдельным источником (`sources.kind = 'external'`), поэтому его записи
//! участвуют в поиске, фильтрах и карточках наравне с сотрудниками AD.
//!
//! Соответствие полей файла и карточки:
//! * `Unit/@Name` — отображаемое имя;
//! * `Unit/@Phone1..Phone3` — внутренний, рабочий и мобильный номера;
//! * `Menu/@Name` — подразделение (вложенные меню разбираются рекурсивно);
//! * `IPPhoneBook/Title` — имя источника (организация в фильтрах); без заголовка
//!   берётся [`FALLBACK_TITLE`].
//!
//! Кэш внешнего источника заменяется целиком при каждой загрузке (та же
//! доктрина, что и у синхронизации AD): правки файла подхватываются без
//! ручной чистки, отключение опции полностью убирает записи из выдачи.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde::Serialize;
use tracing::{debug, info, warn};

use crate::error::AppError;
use crate::services::db::{AdDuplicateRecord, Db, UserRecord};
use crate::services::tokens;

/// Имя источника, когда в файле нет заголовка `IPPhoneBook/Title`.
pub const FALLBACK_TITLE: &str = "Внешний телефонный файл";
/// Суффикс имени источника на случай коллизии с организацией AD: источник
/// с таким именем уже синхронизируется с каталогом, и смешивать кэши нельзя.
pub const COLLISION_SUFFIX: &str = "(файл)";
/// Ограничение размера файла: выгрузка телефонной книги исчисляется
/// килобайтами, мегабайтный XML почти наверняка выбран по ошибке.
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

pub use phonebook_xml::{ParsedPhonebook, PhonebookUnit};

/// Итог загрузки внешнего файла в кэш (DTO события для фронтенда).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum ExternalRefresh {
    /// Опция выключена или путь не задан: кэш внешнего источника очищен.
    Disabled,
    /// Опция включена, но записей больше нет: кэш очищен, `cleared` — сколько
    /// строк убрано из выдачи.
    Cleared { cleared: usize },
    /// Files loaded: `sources` — one entry per imported file, `count` — total records.
    Loaded {
        sources: Vec<ExternalSource>,
        count: usize,
    },
    /// A source file disappeared or cannot be read; the previously cached
    /// external entries are kept and `count` reports how many are still usable.
    Cached { count: usize },
}

/// One imported external phone book source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSource {
    pub organization: String,
    pub count: usize,
}

/// Разобрать XML телефонной книги Yealink (`IPPhoneBook`).
///
/// Сам разбор живёт в `phonebook-xml`, чтобы фуззер не тянул Tauri/SQLite.
pub fn parse_phonebook_xml(xml: &str) -> Result<ParsedPhonebook, AppError> {
    let parsed = phonebook_xml::parse_phonebook_xml(xml)
        .map_err(|error| AppError::ExternalFile(error.to_string()))?;
    debug!(
        units = parsed.units.len(),
        "внешний телефонный файл разобран"
    );
    Ok(parsed)
}

/// Построить записи кэша из разобранного файла.
///
/// Идентификатор записи — детерминированный отпечаток FNV-1a от имени,
/// подразделения и номеров: повторная загрузка того же файла заменяет строки
/// на месте, а не плодит дубликаты. Префикс `ext-` исключает коллизию с
/// GUID сотрудников AD.
pub fn build_records(parsed: &ParsedPhonebook, organization: &str) -> Vec<UserRecord> {
    parsed
        .units
        .iter()
        .map(|unit| {
            let mut token_parts = tokens::initials_tokens(&unit.name);
            token_parts.extend(tokens::phone_tokens(&[
                unit.phones[0].as_deref(),
                unit.phones[1].as_deref(),
                unit.phones[2].as_deref(),
            ]));

            UserRecord {
                object_guid: unit_guid(unit, organization),
                sam_account_name: None,
                first_name: None,
                last_name: None,
                middle_name: None,
                display_name: unit.name.clone(),
                sort_key: tokens::sort_key(&unit.name),
                title: None,
                department: unit.menu.clone(),
                company: Some(organization.to_string()),
                office: None,
                email: None,
                ip_phone: unit.phones[0].clone(),
                phone_external: unit.phones[1].clone(),
                phone_mobile: unit.phones[2].clone(),
                manager: None,
                manager_guid: None,
                pager: None,
                usn_changed: None,
                tokens: token_parts.join(" "),
            }
        })
        .collect()
}

/// Детерминированный идентификатор записи внешнего источника (FNV-1a 64).
fn unit_guid(unit: &PhonebookUnit, organization: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for part in [
        organization,
        unit.name.as_str(),
        unit.menu.as_deref().unwrap_or_default(),
        unit.phones[0].as_deref().unwrap_or_default(),
        unit.phones[1].as_deref().unwrap_or_default(),
        unit.phones[2].as_deref().unwrap_or_default(),
    ] {
        for byte in part.as_bytes().iter().chain(b"\x1f") {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    format!("ext-{hash:016x}")
}

/// Keeps the already-cached external entries when a source file disappears.
/// The database cache is encrypted like the rest of the directory; no
/// plaintext XML copy is written next to the source.
fn cached_fallback(db: &Db, path: &str, reason: String) -> Result<ExternalRefresh, AppError> {
    let count = db.external_count()?;
    if count == 0 {
        return Err(AppError::ExternalFile(format!(
            "не удалось прочитать файл {path}: {reason}"
        )));
    }
    warn!(
        path,
        count, reason, "внешний файл недоступен — использую сохранённый кэш"
    );
    Ok(ExternalRefresh::Cached { count })
}

/// Загрузить внешние телефонные файлы в кэш согласно настройкам.
///
/// Каждый файл становится отдельным источником справочника. Все файлы
/// проверяются до записи в БД: битый файл не оставляет частично обновлённый
/// кэш. Если исходный файл исчез, сохраняется ранее зашифрованный кэш.
pub fn refresh(
    db: &Db,
    enabled: bool,
    paths: &[String],
    hide_ad_duplicates: bool,
) -> Result<ExternalRefresh, AppError> {
    let paths: Vec<&str> = paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .collect();
    if !enabled || paths.is_empty() {
        let cleared = db.clear_external_users()?;
        return Ok(if cleared > 0 {
            ExternalRefresh::Cleared { cleared }
        } else {
            ExternalRefresh::Disabled
        });
    }

    let mut loaded: Vec<(String, Vec<UserRecord>)> = Vec::new();
    let mut used_names = HashSet::new();
    let ad_contacts = if hide_ad_duplicates {
        db.ad_duplicates()?
    } else {
        Vec::new()
    };

    for path in paths {
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) => {
                return cached_fallback(db, path, format!("не удалось открыть файл: {error}"));
            }
        };
        if metadata.len() > MAX_FILE_BYTES {
            return Err(AppError::ExternalFile(format!(
                "файл {path} слишком большой для телефонной книги: {} байт",
                metadata.len()
            )));
        }
        let content = match fs::read_to_string(path) {
            Ok(content) => content,
            Err(error) => {
                return cached_fallback(
                    db,
                    path,
                    format!("не удалось прочитать файл как UTF-8: {error}"),
                );
            }
        };
        let parsed = parse_phonebook_xml(&content)?;

        let fallback = Path::new(path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(tokens::collapse_spaces)
            .filter(|stem| !stem.is_empty())
            .unwrap_or_else(|| FALLBACK_TITLE.to_string());
        let mut organization = parsed.title.clone().unwrap_or(fallback);

        // Collision with an AD source: the caches must not be mixed.
        if db.source_kind(&organization)?.as_deref() == Some("ad") {
            organization = format!("{organization} {COLLISION_SUFFIX}");
        }
        // Duplicate titles among the selected files: keep every source distinct.
        let base = organization.clone();
        let mut suffix = 2;
        while used_names.contains(&organization.to_lowercase()) {
            organization = format!("{base} ({suffix})");
            suffix += 1;
        }
        used_names.insert(organization.to_lowercase());

        let records = build_records(&parsed, &organization);
        let records = if hide_ad_duplicates {
            records
                .into_iter()
                .filter(|record| !is_ad_duplicate(record, &ad_contacts))
                .collect::<Vec<_>>()
        } else {
            records
        };
        loaded.push((organization, records));
    }

    let count = db.replace_external_sources(&loaded)?;
    let sources = loaded
        .iter()
        .map(|(organization, records)| ExternalSource {
            organization: organization.clone(),
            count: records.len(),
        })
        .collect::<Vec<_>>();
    info!(
        files = sources.len(),
        count, "внешние телефонные файлы загружены в справочник"
    );
    Ok(ExternalRefresh::Loaded { sources, count })
}

/// ФИО + любой непустой контакт/атрибут совпадает с AD-контактом.
///
/// Внешняя запись считается дублем только при совпадении имени; одного
/// телефона/почты без совпадения имени недостаточно.
fn is_ad_duplicate(record: &UserRecord, ad_contacts: &[AdDuplicateRecord]) -> bool {
    let name = normalized_text(&record.display_name);
    if name.is_empty() {
        return false;
    }
    ad_contacts.iter().any(|ad| {
        normalized_text(&ad.display_name) == name
            && (same_text(record.email.as_deref(), ad.email.as_deref())
                || same_phone(record.ip_phone.as_deref(), ad.ip_phone.as_deref())
                || same_phone(
                    record.phone_external.as_deref(),
                    ad.phone_external.as_deref(),
                )
                || same_phone(record.phone_mobile.as_deref(), ad.phone_mobile.as_deref())
                || same_text(record.title.as_deref(), ad.title.as_deref())
                || same_text(record.department.as_deref(), ad.department.as_deref())
                || same_text(record.company.as_deref(), ad.company.as_deref())
                || same_text(record.office.as_deref(), ad.office.as_deref()))
    })
}

fn normalized_text(value: &str) -> String {
    tokens::collapse_spaces(value).to_lowercase()
}

fn same_text(left: Option<&str>, right: Option<&str>) -> bool {
    let left = left.map(normalized_text).filter(|value| !value.is_empty());
    let right = right.map(normalized_text).filter(|value| !value.is_empty());
    matches!((left, right), (Some(left), Some(right)) if left == right)
}

fn same_phone(left: Option<&str>, right: Option<&str>) -> bool {
    let digits = |value: &str| {
        value
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect::<String>()
    };
    let left = left.map(digits).filter(|value| !value.is_empty());
    let right = right.map(digits).filter(|value| !value.is_empty());
    matches!((left, right), (Some(left), Some(right)) if left == right)
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    proptest! {
        #[test]
        fn parser_never_panics_on_arbitrary_xml(input in "\\PC{0,2048}") {
            let _ = parse_phonebook_xml(&input);
        }
    }

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<IPPhoneBook>
  <Title>Yealink</Title>
  <Menu Name="Тестовое">
    <Unit Name="ТЕСТ" Phone1="310" Phone2="" Phone3="" default_photo="Resource:" />
    <Unit Name="Тест &amp; Ко" Phone1="311" Phone2="8-495-100" Phone3="" default_photo="Resource:" />
    <Menu Name="Вложенное">
      <Unit Name="Вложенный пункт" Phone1="312" />
    </Menu>
  </Menu>
  <Unit Name="Без меню" Phone1="300" />
</IPPhoneBook>"#;

    #[test]
    fn parses_units_menus_and_title() {
        let parsed = parse_phonebook_xml(SAMPLE).expect("parse");
        assert_eq!(parsed.title.as_deref(), Some("Yealink"));
        assert_eq!(parsed.units.len(), 4);

        let first = &parsed.units[0];
        assert_eq!(first.name, "ТЕСТ");
        assert_eq!(first.phones[0].as_deref(), Some("310"));
        assert_eq!(first.phones[1], None);
        assert_eq!(first.menu.as_deref(), Some("Тестовое"));

        let second = &parsed.units[1];
        assert_eq!(second.name, "Тест & Ко");
        assert_eq!(second.phones[1].as_deref(), Some("8-495-100"));

        let nested = &parsed.units[2];
        assert_eq!(nested.menu.as_deref(), Some("Вложенное"));

        let plain = &parsed.units[3];
        assert_eq!(plain.menu, None);
    }

    #[test]
    fn malformed_xml_is_external_file_error() {
        let error = parse_phonebook_xml("<IPPhoneBook><Menu Name=\"x\">").expect_err("error");
        assert_eq!(error.code(), "EXTERNAL_FILE");
    }

    #[test]
    fn file_without_units_is_rejected() {
        let error = parse_phonebook_xml("<IPPhoneBook><Title>Yealink</Title></IPPhoneBook>")
            .expect_err("error");
        assert_eq!(error.code(), "EXTERNAL_FILE");
    }

    #[test]
    fn bom_is_tolerated() {
        let parsed = parse_phonebook_xml(&format!("\u{feff}{SAMPLE}")).expect("parse");
        assert_eq!(parsed.title.as_deref(), Some("Yealink"));
    }

    #[test]
    fn records_map_phones_and_department() {
        let parsed = parse_phonebook_xml(SAMPLE).expect("parse");
        let records = build_records(&parsed, "Yealink");
        assert_eq!(records.len(), 4);

        let first = &records[0];
        assert_eq!(first.display_name, "ТЕСТ");
        assert_eq!(first.ip_phone.as_deref(), Some("310"));
        assert_eq!(first.department.as_deref(), Some("Тестовое"));
        assert_eq!(first.company.as_deref(), Some("Yealink"));
        // Номер ищет и хвост: триграммный индекс строится по тем же токеням.
        assert!(first.tokens.contains("310"));
    }

    #[test]
    fn guid_is_deterministic_and_content_dependent() {
        let parsed = parse_phonebook_xml(SAMPLE).expect("parse");
        let again = parse_phonebook_xml(SAMPLE).expect("parse");
        let left = build_records(&parsed, "Yealink");
        let right = build_records(&again, "Yealink");
        assert_eq!(left[0].object_guid, right[0].object_guid);
        assert_ne!(left[0].object_guid, left[1].object_guid);
        assert!(left[0].object_guid.starts_with("ext-"));
    }

    #[test]
    fn xml_to_db_is_searchable_by_name_and_phone_tail() {
        use crate::services::db::{Db, SearchParams};

        let parsed = parse_phonebook_xml(SAMPLE).expect("parse");
        let records = build_records(&parsed, "Yealink");
        let db = Db::open_in_memory().expect("db");
        db.replace_external_users("Yealink", &records)
            .expect("load");

        let by_name = db
            .search(SearchParams {
                query: Some("Тест".into()),
                ..Default::default()
            })
            .expect("name search");
        assert!(by_name.items.iter().any(|item| item
            .display_name
            .as_deref()
            .unwrap_or_default()
            .contains("Тест")));

        let by_phone = db
            .search(SearchParams {
                query: Some("100".into()),
                ..Default::default()
            })
            .expect("phone search");
        assert!(by_phone.items.iter().any(|item| item
            .display_name
            .as_deref()
            .unwrap_or_default()
            .contains("Тест & Ко")));
    }

    #[test]
    fn refresh_imports_each_file_as_its_own_source() {
        use crate::services::db::Db;

        let db = Db::open_in_memory().expect("db");
        let dir = std::env::temp_dir().join(format!(
            "kmpb-external-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let first = dir.join("first.xml");
        let second = dir.join("second.xml");
        std::fs::write(&first, SAMPLE.replace("Yealink", "Source A")).expect("first");
        std::fs::write(&second, SAMPLE.replace("Yealink", "Source B")).expect("second");

        let paths = vec![
            first.to_string_lossy().into_owned(),
            second.to_string_lossy().into_owned(),
        ];
        let result = refresh(&db, true, &paths, true).expect("refresh");
        let ExternalRefresh::Loaded { sources, count } = result else {
            panic!("expected loaded result");
        };
        assert_eq!(count, 8);
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].organization, "Source A");
        assert_eq!(sources[1].organization, "Source B");
        assert_eq!(db.count().expect("count"), 8);
        let orgs = db.list_organizations().expect("orgs");
        assert!(orgs.contains(&"Source A".to_string()));
        assert!(orgs.contains(&"Source B".to_string()));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_source_keeps_cached_entries() {
        use crate::services::db::Db;

        let db = Db::open_in_memory().expect("db");
        let parsed = parse_phonebook_xml(SAMPLE).expect("parse");
        let records = build_records(&parsed, "Yealink");
        db.replace_external_sources(&[("Yealink".to_string(), records)])
            .expect("load");

        let missing = std::env::temp_dir()
            .join("kmpb-external-missing.xml")
            .to_string_lossy()
            .into_owned();
        let result = refresh(&db, true, &[missing], true).expect("cached fallback");
        assert_eq!(result, ExternalRefresh::Cached { count: 4 });
        assert_eq!(db.external_count().expect("count"), 4);
    }

    #[test]
    fn external_duplicate_of_ad_contact_is_filtered() {
        let parsed = parse_phonebook_xml(SAMPLE).expect("parse");
        let records = build_records(&parsed, "Yealink");
        let external = &records[0];
        let ad = AdDuplicateRecord {
            display_name: external.display_name.clone(),
            title: None,
            department: external.department.clone(),
            company: None,
            office: None,
            email: None,
            ip_phone: external.ip_phone.clone(),
            phone_external: None,
            phone_mobile: None,
        };

        assert!(is_ad_duplicate(external, std::slice::from_ref(&ad)));

        let mut wrong_name = ad.clone();
        wrong_name.display_name = format!("{} 2", external.display_name);
        assert!(!is_ad_duplicate(external, &[wrong_name]));

        let unrelated = AdDuplicateRecord {
            display_name: external.display_name.clone(),
            title: None,
            department: None,
            company: None,
            office: None,
            email: Some("other@example.invalid".into()),
            ip_phone: Some("999999".into()),
            phone_external: None,
            phone_mobile: None,
        };
        assert!(!is_ad_duplicate(external, &[unrelated]));
    }
}
