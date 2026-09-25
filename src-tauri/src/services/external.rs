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

use std::fs;

use quick_xml::escape::unescape as unescape_xml;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use tracing::{debug, info};

use crate::error::AppError;
use crate::services::db::{Db, UserRecord};
use crate::services::tokens;

/// Имя источника, когда в файле нет заголовка `IPPhoneBook/Title`.
pub const FALLBACK_TITLE: &str = "Внешний телефонный файл";
/// Суффикс имени источника на случай коллизии с организацией AD: источник
/// с таким именем уже синхронизируется с каталогом, и смешивать кэши нельзя.
pub const COLLISION_SUFFIX: &str = "(файл)";
/// Ограничение размера файла: выгрузка телефонной книги исчисляется
/// килобайтами, мегабайтный XML почти наверняка выбран по ошибке.
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// Запись `Unit` внешнего телефонного файла.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhonebookUnit {
    /// Отображаемое имя (`Unit/@Name`).
    pub name: String,
    /// Номера `Phone1..Phone3` (пустые атрибуты — `None`).
    pub phones: [Option<String>; 3],
    /// Имя ближайшего объемлющего `Menu` (подразделение).
    pub menu: Option<String>,
}

/// Результат разбора XML телефонной книги.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedPhonebook {
    /// Заголовок `IPPhoneBook/Title` (имя источника в справочнике).
    pub title: Option<String>,
    /// Записи `Unit` в порядке следования в файле.
    pub units: Vec<PhonebookUnit>,
}

/// Итог загрузки внешнего файла в кэш (DTO события для фронтенда).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum ExternalRefresh {
    /// Опция выключена или путь не задан: кэш внешнего источника очищен.
    Disabled,
    /// Опция включена, но записей больше нет: кэш очищен, `cleared` — сколько
    /// строк убрано из выдачи.
    Cleared { cleared: usize },
    /// Файл загружен: `organization` — имя источника, `count` — число записей.
    Loaded { organization: String, count: usize },
}

/// Разобрать XML телефонной книги Yealink (`IPPhoneBook`).
///
/// Разбор потоковый: держим стек имён `Menu` и собираем атрибуты `Unit`.
/// Имена элементов и атрибутов сравниваются без учёта регистра — прошивки
/// телефонов не гарантируют точное написание тегов.
///
/// # Ошибки
/// [`AppError::ExternalFile`] — файл не является корректным XML или не
/// содержит ни одной записи `Unit` (вероятно, выбран не тот файл).
pub fn parse_phonebook_xml(xml: &str) -> Result<ParsedPhonebook, AppError> {
    // BOM копировального экспорта не несёт данных — убираем до разбора.
    let xml = xml.strip_prefix('\u{feff}').unwrap_or(xml);

    let mut reader = Reader::from_str(xml);

    let mut title: Option<String> = None;
    let mut units: Vec<PhonebookUnit> = Vec::new();
    let mut menu_stack: Vec<String> = Vec::new();
    let mut in_title = false;

    loop {
        // В quick-xml 0.42 событие приходит в `Result`: ошибка разбора
        // прерывает весь файл — частичный телефонный список хуже отказа.
        let event = match reader.read_event() {
            Ok(event) => event,
            Err(e) => {
                return Err(AppError::ExternalFile(format!(
                    "некорректный XML: {e} (позиция {})",
                    reader.error_position()
                )))
            }
        };
        match event {
            Event::Start(element) => match tag_name(&element).as_str() {
                "menu" => menu_stack.push(attribute_text(&element, "name").unwrap_or_default()),
                "unit" => push_unit(&element, &menu_stack, &mut units),
                "title" if menu_stack.is_empty() => in_title = true,
                _ => {}
            },
            // Самозакрывающиеся элементы: меню без потомков не добавляет
            // уровня вложенности, `Unit` встречается и в такой форме.
            Event::Empty(element) => {
                if tag_name(&element).as_str() == "unit" {
                    push_unit(&element, &menu_stack, &mut units);
                }
            }
            Event::End(element) => {
                match element.local_name().as_ref().to_ascii_lowercase().as_str() {
                    "menu" => {
                        menu_stack.pop();
                    }
                    "title" => in_title = false,
                    _ => {}
                }
            }
            Event::Text(text) if in_title => {
                let raw = text.into_inner();
                let value = unescape_xml(raw.as_ref())
                    .map_err(|e| AppError::ExternalFile(format!("некорректный XML: {e}")))?;
                let value = value.trim();
                if !value.is_empty() && title.is_none() {
                    title = Some(value.to_string());
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if units.is_empty() {
        return Err(AppError::ExternalFile(
            "в файле нет ни одной записи Unit — проверьте, что выбран файл телефонной книги".into(),
        ));
    }
    debug!(units = units.len(), "внешний телефонный файл разобран");
    Ok(ParsedPhonebook { title, units })
}

/// Имя элемента в нижнем регистре: прошивки телефонов не гарантируют точное
/// написание тегов, а формат файла сравниваем без учёта регистра.
fn tag_name(element: &quick_xml::events::BytesStart<'_>) -> String {
    element.local_name().as_ref().to_ascii_lowercase()
}

/// Добавить запись `Unit` в разбор: имя обязательно, ближайшие `Menu` дают
/// подразделение, пустые атрибуты номеров не считаются значениями.
fn push_unit(
    element: &quick_xml::events::BytesStart<'_>,
    menu_stack: &[String],
    units: &mut Vec<PhonebookUnit>,
) {
    let Some(name) = attribute_text(element, "name") else {
        return;
    };
    units.push(PhonebookUnit {
        name,
        phones: [
            attribute_text(element, "phone1"),
            attribute_text(element, "phone2"),
            attribute_text(element, "phone3"),
        ],
        menu: menu_stack.last().filter(|menu| !menu.is_empty()).cloned(),
    });
}

/// Значение атрибута элемента: обрезанное, с раскрытыми XML-энтити;
/// пустые строки не считаются значением (`Phone2=""` — обычный случай).
fn attribute_text(element: &quick_xml::events::BytesStart<'_>, attribute: &str) -> Option<String> {
    element
        .attributes()
        .flatten()
        .find(|attr| attr.key.as_ref().eq_ignore_ascii_case(attribute))
        .and_then(|attr| {
            unescape_xml(attr.value.as_ref())
                .ok()
                .map(|v| v.into_owned())
        })
        .map(|value| tokens::collapse_spaces(value.trim()))
        .filter(|value| !value.is_empty())
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
                object_guid: unit_guid(unit),
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
fn unit_guid(unit: &PhonebookUnit) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for part in [
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

/// Загрузить внешний телефонный файл в кэш согласно настройкам.
///
/// Вызывается планировщиком синхронизации, прогоном синхронизации и командой
/// из настроек. Ошибка чтения/разбора не роняет вызывающего: логируется
/// и возвращается как `Err` — решение о показе принимает слой команд.
pub fn refresh(db: &Db, enabled: bool, path: Option<&str>) -> Result<ExternalRefresh, AppError> {
    let path = path.map(str::trim).filter(|path| !path.is_empty());
    if !enabled || path.is_none() {
        let cleared = db.clear_external_users()?;
        return Ok(if cleared > 0 {
            ExternalRefresh::Cleared { cleared }
        } else {
            ExternalRefresh::Disabled
        });
    }
    let path = path.expect("проверено выше");

    let metadata = fs::metadata(path)
        .map_err(|e| AppError::ExternalFile(format!("не удалось открыть файл: {e}")))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(AppError::ExternalFile(format!(
            "файл слишком большой для телефонной книги: {} байт",
            metadata.len()
        )));
    }
    let content = fs::read_to_string(path).map_err(|e| {
        AppError::ExternalFile(format!(
            "не удалось прочитать файл как UTF-8: {e}. Сохраните выгрузку в кодировке UTF-8"
        ))
    })?;

    let parsed = parse_phonebook_xml(&content)?;
    let mut organization = parsed
        .title
        .clone()
        .unwrap_or_else(|| FALLBACK_TITLE.to_string());
    // Коллизия имени источника с подключением AD: кэши не должны смешиваться.
    if db.source_kind(&organization)?.as_deref() == Some("ad") {
        organization = format!("{organization} {COLLISION_SUFFIX}");
    }

    let records = build_records(&parsed, &organization);
    let count = db.replace_external_users(&organization, &records)?;
    info!(
        organization = %organization,
        count,
        "внешний телефонный файл загружен в справочник"
    );
    Ok(ExternalRefresh::Loaded {
        organization,
        count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
