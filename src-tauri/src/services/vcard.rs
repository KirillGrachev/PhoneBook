//! vCard 3.0 generation (RFC 2426) for a contact QR code.
//!
//! Unlike a naive implementation, the format requirements are met here:
//! * CRLF line separators;
//! * folding of long lines (<= 74 octets, continuation starts with a space) -
//!   without this, large QR codes are unreadable by some phones;
//! * escaping `\`, `;`, `,`, and newlines;
//! * normalization of Russian mobile numbers to `+7...`.

use serde::Deserialize;

/// Contact data sent by the frontend for vCard generation.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VCardInput {
    pub full_name: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub organization: Option<String>,
    #[serde(default)]
    pub department: Option<String>,
    #[serde(default)]
    pub job_title: Option<String>,
    #[serde(default)]
    pub mobile_phone: Option<String>,
    #[serde(default)]
    pub ip_phone: Option<String>,
    /// Full (external) IP telephony number.
    #[serde(default)]
    pub phone_external: Option<String>,
    /// Enterprise mode (the "KMAruda" tab in the non-global version): in the QR
    /// the external number is substituted instead of the internal one - from outside the short
    /// the internal number is not dialable.
    #[serde(default)]
    pub prefer_external_phone: bool,
    #[serde(default)]
    pub email: Option<String>,
}

const CRLF: &str = "\r\n";
/// Octet limit on the first physical line (RFC 2426: 75 including CRLF).
const MAX_FIRST_LINE: usize = 74;
/// Octet limit on continuation lines (the first character is a space).
const MAX_CONT_LINE: usize = 73;

pub fn generate(contact: &VCardInput) -> String {
    let mut lines: Vec<String> = Vec::with_capacity(12);
    lines.push("BEGIN:VCARD".to_string());
    lines.push("VERSION:3.0".to_string());

    if let Some(uid) = contact
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        lines.push(format!("UID:{uid}"));
    }

    let full_name = contact.full_name.trim();
    lines.push(format!("FN:{}", escape(full_name)));

    let (last, first, middle) = split_name(full_name);
    lines.push(format!(
        "N:{};{};{};;",
        escape(last),
        escape(first),
        escape(middle)
    ));

    let organization = contact.organization.as_deref().unwrap_or_default().trim();
    let department = contact.department.as_deref().unwrap_or_default().trim();
    if !organization.is_empty() || !department.is_empty() {
        lines.push(format!(
            "ORG:{};{}",
            escape(organization),
            escape(department)
        ));
    }

    if let Some(title) = contact
        .job_title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        lines.push(format!("TITLE:{}", escape(title)));
    }

    // The mobile first: client phones (e.g. Samsung) take the first
    // TEL as the primary contact number; the corporate one stays second.
    if let Some(mobile) = contact
        .mobile_phone
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        lines.push(format!(
            "TEL;TYPE=CELL:{}",
            escape(&normalize_phone(mobile))
        ));
    }
    // The corporate number: in enterprise mode (the "KMAruda" tab of the non-
    // global version) - ONLY the external (full) number: the internal short
    // number is not dialable from outside, and in this mode it has no place in the QR, even
    // as a fallback. In the other modes - the internal number, as usual.
    let work_phone = if contact.prefer_external_phone {
        contact.phone_external.as_deref()
    } else {
        contact.ip_phone.as_deref()
    };
    if let Some(ip) = work_phone.map(str::trim).filter(|p| !p.is_empty()) {
        lines.push(format!(
            "TEL;TYPE=WORK,VOICE:{}",
            escape(&normalize_phone(ip))
        ));
    }
    if let Some(email) = contact
        .email
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        lines.push(format!("EMAIL;TYPE=INTERNET:{}", escape(email)));
    }

    lines.push("END:VCARD".to_string());

    lines
        .iter()
        .map(|line| fold_line(line))
        .collect::<Vec<_>>()
        .join(CRLF)
}

/// Escaping vCard special characters.
pub fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            _ => out.push(ch),
        }
    }
    out
}

/// Splitting the full name into components for the `N` field.
///
/// Russian tradition: "Surname GivenName Patronymic". Everything beyond three parts,
/// appended to the patronymic.
pub fn split_name(full_name: &str) -> (&str, &str, &str) {
    let mut parts = full_name.split_whitespace();
    match (parts.next(), parts.next(), parts.next()) {
        (Some(last), Some(first), Some(middle)) => (last, first, middle),
        (Some(last), Some(first), None) => (last, first, ""),
        (Some(only), None, None) => ("", only, ""),
        (None, None, None) => ("", "", ""),
        _ => unreachable!(),
    }
}

/// Normalization of Russian numbers: `8 (999) 111-22-33` -> `+79991112233`.
/// Short internal numbers (1-6 digits) are left untouched.
pub fn normalize_phone(phone: &str) -> String {
    let mut digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return phone.trim().to_string();
    }

    let had_plus = phone.trim_start().starts_with('+');
    if had_plus {
        return format!("+{digits}");
    }
    if digits.len() == 11 && (digits.starts_with('8') || digits.starts_with('7')) {
        digits.replace_range(0..1, "7");
        return format!("+{digits}");
    }
    if digits.len() == 10 && digits.starts_with('9') {
        return format!("+7{digits}");
    }
    digits
}

/// Folding a vCard line at UTF-8 character boundaries.
pub fn fold_line(line: &str) -> String {
    if line.len() <= MAX_FIRST_LINE {
        return line.to_string();
    }
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut budget = MAX_FIRST_LINE;
    for ch in line.chars() {
        if current.len() + ch.len_utf8() > budget {
            chunks.push(std::mem::take(&mut current));
            budget = MAX_CONT_LINE;
        }
        current.push(ch);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks.join(&format!("{CRLF} "))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> VCardInput {
        serde_json::from_str(
            r#"{
                "id": "abc-123",
                "fullName": "Иванов Иван Иванович",
                "organization": "ООО \"КМАруда\"",
                "department": "IT отдел",
                "jobTitle": "Системный администратор",
                "mobilePhone": "8 (999) 111-22-33",
                "ipPhone": "1234",
                "email": "ivanov@kmaruda.ru"
            }"#,
        )
        .expect("deserialize input")
    }

    #[test]
    fn generates_valid_vcard_structure() {
        let vcard = generate(&input());
        assert!(vcard.starts_with("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
        assert!(vcard.ends_with("END:VCARD"));
        assert!(vcard.contains("FN:Иванов Иван Иванович"));
        assert!(vcard.contains("N:Иванов;Иван;Иванович;;"));
        assert!(vcard.contains("ORG:ООО \"КМАруда\";IT отдел"));
        assert!(vcard.contains("TITLE:Системный администратор"));
        assert!(vcard.contains("TEL;TYPE=CELL:+79991112233"));
        assert!(vcard.contains("TEL;TYPE=WORK,VOICE:1234"));
        // The mobile goes as the first TEL: phone clients take the first number
        // as primary (the Samsung case with two fields).
        assert!(
            vcard.find("TEL;TYPE=CELL").expect("cell") < vcard.find("TEL;TYPE=WORK").expect("work")
        );
        assert!(vcard.contains("EMAIL;TYPE=INTERNET:ivanov@kmaruda.ru"));
        assert!(vcard.contains("UID:abc-123"));
    }

    #[test]
    fn escapes_special_characters() {
        assert_eq!(escape(r"a\b;c,d"), r"a\\b\;c\,d");
        assert_eq!(escape("line1\nline2"), r"line1\nline2");
    }

    #[test]
    fn folds_long_lines_by_octets() {
        let long = format!("NOTE:{}", "я".repeat(60)); // 60 * 2 bytes = 120+ octets
        let folded = fold_line(&long);
        for physical in folded.split("\r\n") {
            assert!(
                physical.len() <= MAX_FIRST_LINE,
                "строка длиннее лимита: {}",
                physical.len()
            );
        }
        // Continuations start with a space.
        assert!(folded.contains("\r\n "));
        // After unfold the content was not lost.
        assert_eq!(folded.replace("\r\n ", ""), long);
    }

    #[test]
    fn does_not_fold_short_lines() {
        assert_eq!(fold_line("FN:Короткое имя"), "FN:Короткое имя");
    }

    #[test]
    fn normalizes_russian_phone_numbers() {
        assert_eq!(normalize_phone("8 (999) 111-22-33"), "+79991112233");
        assert_eq!(normalize_phone("79991112233"), "+79991112233");
        assert_eq!(normalize_phone("+7 999 111 22 33"), "+79991112233");
        assert_eq!(normalize_phone("9991112233"), "+79991112233");
        // We do not touch internal numbers.
        assert_eq!(normalize_phone("1234"), "1234");
    }

    #[test]
    fn splits_names() {
        assert_eq!(
            split_name("Иванов Иван Иванович"),
            ("Иванов", "Иван", "Иванович")
        );
        assert_eq!(split_name("Иванов Иван"), ("Иванов", "Иван", ""));
        assert_eq!(split_name("Псевдоним"), ("", "Псевдоним", ""));
    }

    #[test]
    fn minimal_contact_still_valid() {
        let minimal: VCardInput =
            serde_json::from_str(r#"{ "fullName": "Безымянный" }"#).expect("parse");
        let vcard = generate(&minimal);
        assert!(vcard.contains("FN:Безымянный"));
        assert!(!vcard.contains("ORG:"));
        assert!(!vcard.contains("TEL"));
    }

    #[test]
    fn enterprise_mode_prefers_external_phone() {
        let mut input = input();
        input.phone_external = Some("+7 (495) 123-45-67".into());
        input.prefer_external_phone = true;
        let vcard = generate(&input);
        assert!(vcard.contains("TEL;TYPE=WORK,VOICE:+74951234567"));
        assert!(!vcard.contains("TEL;TYPE=WORK,VOICE:1234"));
        // The mobile is still the first TEL.
        assert!(
            vcard.find("TEL;TYPE=CELL").expect("cell") < vcard.find("TEL;TYPE=WORK").expect("work")
        );
    }

    #[test]
    fn enterprise_mode_never_exposes_internal_phone() {
        // There is no external number — the corporate TEL is absent entirely:
        // the internal number is not substituted into the QR in enterprise mode.
        let mut input = input();
        input.prefer_external_phone = true;
        let vcard = generate(&input);
        assert!(!vcard.contains("TEL;TYPE=WORK"));
        assert!(vcard.contains("TEL;TYPE=CELL:+79991112233"));
    }
}
