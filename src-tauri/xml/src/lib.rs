//! Streaming parser for the Yealink `IPPhoneBook` XML export.
//!
//! Kept independent of Tauri/SQLite so the fuzzer and parser tests can link
//! without the desktop stack.

use std::fmt;

use quick_xml::escape::unescape as unescape_xml;
use quick_xml::events::Event;
use quick_xml::Reader;

/// One `Unit` entry of the external phone book.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhonebookUnit {
    /// Display name (`Unit/@Name`).
    pub name: String,
    /// `Phone1..Phone3`; empty attributes are `None`.
    pub phones: [Option<String>; 3],
    /// Nearest enclosing `Menu` name.
    pub menu: Option<String>,
}

/// Result of parsing a phone book export.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedPhonebook {
    pub title: Option<String>,
    pub units: Vec<PhonebookUnit>,
}

/// Invalid or empty phone book file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    message: String,
}

impl ParseError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ParseError {}

/// Parse a Yealink `IPPhoneBook` XML document.
pub fn parse_phonebook_xml(xml: &str) -> Result<ParsedPhonebook, ParseError> {
    // A BOM from copy/export tools carries no data.
    let xml = xml.strip_prefix('\u{feff}').unwrap_or(xml);

    let mut reader = Reader::from_str(xml);
    let mut title: Option<String> = None;
    let mut units: Vec<PhonebookUnit> = Vec::new();
    let mut menu_stack: Vec<String> = Vec::new();
    let mut in_title = false;

    loop {
        let event = reader.read_event().map_err(|error| {
            ParseError::new(format!(
                "некорректный XML: {error} (позиция {})",
                reader.error_position()
            ))
        })?;
        match event {
            Event::Start(element) => match tag_name(&element).as_str() {
                "menu" => menu_stack.push(attribute_text(&element, "name").unwrap_or_default()),
                "unit" => push_unit(&element, &menu_stack, &mut units),
                "title" if menu_stack.is_empty() => in_title = true,
                _ => {}
            },
            Event::Empty(element) if tag_name(&element).as_str() == "unit" => {
                push_unit(&element, &menu_stack, &mut units);
            }
            Event::Empty(_) => {}
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
                    .map_err(|error| ParseError::new(format!("некорректный XML: {error}")))?;
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
        return Err(ParseError::new(
            "в файле нет ни одной записи Unit — проверьте, что выбран файл телефонной книги",
        ));
    }
    Ok(ParsedPhonebook { title, units })
}

fn tag_name(element: &quick_xml::events::BytesStart<'_>) -> String {
    element.local_name().as_ref().to_ascii_lowercase()
}

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

fn attribute_text(element: &quick_xml::events::BytesStart<'_>, attribute: &str) -> Option<String> {
    element
        .attributes()
        .flatten()
        .find(|attr| attr.key.as_ref().eq_ignore_ascii_case(attribute))
        .and_then(|attr| {
            unescape_xml(attr.value.as_ref())
                .ok()
                .map(|value| value.into_owned())
        })
        .map(|value| collapse_spaces(value.trim()))
        .filter(|value| !value.is_empty())
}

fn collapse_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<IPPhoneBook><Title>Yealink</Title><Menu Name="Sales"><Unit Name="Ivanov Ivan" Phone1="123" Phone2="" /></Menu></IPPhoneBook>"#;

    #[test]
    fn parses_title_units_and_menu() {
        let parsed = parse_phonebook_xml(SAMPLE).expect("parse");
        assert_eq!(parsed.title.as_deref(), Some("Yealink"));
        assert_eq!(parsed.units.len(), 1);
        assert_eq!(parsed.units[0].name, "Ivanov Ivan");
        assert_eq!(parsed.units[0].phones[0].as_deref(), Some("123"));
        assert_eq!(parsed.units[0].phones[1], None);
        assert_eq!(parsed.units[0].menu.as_deref(), Some("Sales"));
    }

    #[test]
    fn rejects_file_without_units() {
        let error = parse_phonebook_xml("<IPPhoneBook><Title>Yealink</Title></IPPhoneBook>")
            .expect_err("must fail");
        assert!(error.to_string().contains("Unit"));
    }
}
