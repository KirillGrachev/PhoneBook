//! Генерация vCard 3.0 (RFC 2426) для QR-кода контакта.
//!
//! В отличие от наивной реализации, здесь соблюдены требования формата:
//! * разделители строк CRLF;
//! * folding длинных строк (≤ 74 октета, продолжение начинается с пробела) —
//!   без этого крупные QR-коды не читаются некоторыми телефонами;
//! * экранирование `\`, `;`, `,` и переводов строк;
//! * нормализация российских мобильных номеров к `+7...`.

use serde::Deserialize;

/// Контактные данные, присылаемые фронтендом для генерации vCard.
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
    /// Полный (внешний) номер IP-телефонии.
    #[serde(default)]
    pub phone_external: Option<String>,
    /// Режим предприятия (вкладка «КМАруда» не глобальной версии): в QR
    /// подставляется внешний номер вместо внутреннего — снаружи короткий
    /// внутренний номер ненабираем.
    #[serde(default)]
    pub prefer_external_phone: bool,
    #[serde(default)]
    pub email: Option<String>,
}

const CRLF: &str = "\r\n";
/// Лимит октетов в первой физической строке (RFC 2426: 75 с учётом CRLF).
const MAX_FIRST_LINE: usize = 74;
/// Лимит октетов в строках продолжения (первый символ — пробел).
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

    // Мобильный — первым: телефоны-клиенты (например, Samsung) берут первый
    // TEL как основной номер контакта; корпоративный остаётся вторым.
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
    // Корпоративный номер: в режиме предприятия (вкладка «КМАруда» не
    // глобальной версии) — ТОЛЬКО внешний (полный): внутренний короткий
    // номер снаружи ненабираем, и в QR ему в этом режиме места нет, даже
    // как фолбэк. В остальных режимах — внутренний, как обычно.
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

/// Экранирование специальных символов vCard.
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

/// Разбиение ФИО на компоненты для поля `N`.
///
/// Русская традиция: «Фамилия Имя Отчество». Всё, что сверх трёх частей,
/// присоединяется к отчеству.
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

/// Нормализация российских номеров: `8 (999) 111-22-33` → `+79991112233`.
/// Короткие внутренние номера (1–6 цифр) не трогаем.
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

/// Folding строки vCard по границам UTF-8 символов.
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
        // Мобильный идёт первым TEL: клиенты телефонов берут первый номер
        // как основной (кейс Samsung с двумя полями).
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
        let long = format!("NOTE:{}", "я".repeat(60)); // 60 * 2 байта = 120+ октетов
        let folded = fold_line(&long);
        for physical in folded.split("\r\n") {
            assert!(
                physical.len() <= MAX_FIRST_LINE,
                "строка длиннее лимита: {}",
                physical.len()
            );
        }
        // Продолжения начинаются с пробела.
        assert!(folded.contains("\r\n "));
        // После unfold содержимое не потерялось.
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
        // Внутренние номера не трогаем.
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
        // Мобильный по-прежнему первый TEL.
        assert!(
            vcard.find("TEL;TYPE=CELL").expect("cell") < vcard.find("TEL;TYPE=WORK").expect("work")
        );
    }

    #[test]
    fn enterprise_mode_never_exposes_internal_phone() {
        // Внешнего номера нет — корпоративный TEL отсутствует вовсе:
        // внутренний в режиме предприятия в QR не подставляется.
        let mut input = input();
        input.prefer_external_phone = true;
        let vcard = generate(&input);
        assert!(!vcard.contains("TEL;TYPE=WORK"));
        assert!(vcard.contains("TEL;TYPE=CELL:+79991112233"));
    }
}
