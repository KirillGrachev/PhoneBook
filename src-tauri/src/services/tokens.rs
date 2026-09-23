//! Формирование поисковых токенов и FTS-запросов.
//!
//! Модуль содержит только чистые функции — он полностью покрыт unit-тестами
//! и не зависит от Tauri/базы данных.
//!
//! Особенности предметной области:
//! * Пользователи часто набирают русские имена, забыв переключить раскладку
//!   («ьшлукщы» вместо «директор»), поэтому каждый токен запроса раскладывается
//!   на три варианта: исходный, QWERTY→ЙЦУКЕН и ЙЦУКЕН→QWERTY.
//! * Телефоны ищутся по «хвостам» номеров (последние 4 и 7 цифр):
//!   внутренний номер спрашивают коротким хвостом, а не полным числом.
//! * SQLite `lower()`/`NOCASE` не работают с кириллицей, поэтому ключ
//!   сортировки (`sort_key`) вычисляется на стороне Rust.

/// Соответствие QWERTY → ЙЦУКЕН (раскладка ПК).
const EN_TO_RU: [(&str, &str); 33] = [
    ("q", "й"),
    ("w", "ц"),
    ("e", "у"),
    ("r", "к"),
    ("t", "е"),
    ("y", "н"),
    ("u", "г"),
    ("i", "ш"),
    ("o", "щ"),
    ("p", "з"),
    ("[", "х"),
    ("]", "ъ"),
    ("a", "ф"),
    ("s", "ы"),
    ("d", "в"),
    ("f", "а"),
    ("g", "п"),
    ("h", "р"),
    ("j", "о"),
    ("k", "л"),
    ("l", "д"),
    (";", "ж"),
    ("'", "э"),
    ("z", "я"),
    ("x", "ч"),
    ("c", "с"),
    ("v", "м"),
    ("b", "и"),
    ("n", "т"),
    ("m", "ь"),
    (",", "б"),
    (".", "ю"),
    ("`", "ё"),
];

fn map_layout(input: &str, en_to_ru: bool) -> String {
    input
        .chars()
        .map(|c| {
            let lower = c.to_lowercase().collect::<String>();
            for (en, ru) in EN_TO_RU {
                if en_to_ru && lower == *en {
                    return (*ru).to_string();
                }
                if !en_to_ru && lower == *ru {
                    return (*en).to_string();
                }
            }
            lower
        })
        .collect()
}

/// Перевод строки в русскую раскладку: `ivanov` → `штфмпд`.
pub fn to_ru_layout(input: &str) -> String {
    map_layout(input, true)
}

/// Перевод строки в английскую раскладку: `иванов` → `bdfyjd`.
pub fn to_en_layout(input: &str) -> String {
    map_layout(input, false)
}

/// Нормализация пробелов: обрезка + схлопывание повторов
/// («ООО  КМАруда» → «ООО КМАруда»).
pub fn collapse_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Ключ дедупликации организации: нормализованные пробелы + нижний регистр.
/// Вычисляется в Rust, потому что SQLite `lower()` не знает кириллицу.
pub fn company_key(value: &str) -> String {
    collapse_spaces(value).to_lowercase()
}

/// Ключ сортировки: unicode-lowercase (кириллица включительно).
pub fn sort_key(display_name: &str) -> String {
    display_name.to_lowercase()
}

/// Токены инициалов: «Иванов Иван Иванович» → `["иии", "ии"]`.
/// Одиночные инициалы отбрасываются — иначе FTS-индекс тонет в мусоре.
pub fn initials_tokens(display_name: &str) -> Vec<String> {
    let initials: String = display_name
        .split_whitespace()
        .filter_map(|part| part.chars().next())
        .flat_map(char::to_lowercase)
        .collect();

    let count = initials.chars().count();
    let mut tokens = Vec::new();
    if count >= 2 {
        let short: String = initials.chars().take(2).collect();
        tokens.push(short);
    }
    if count >= 3 {
        tokens.push(initials);
    }
    tokens.sort();
    tokens.dedup();
    tokens
}

/// Токены e-mail: адрес целиком, локальная часть, домен, домен без TLD.
pub fn email_tokens(email: &str) -> Vec<String> {
    let email = email.trim().to_lowercase();
    if email.is_empty() {
        return Vec::new();
    }
    let mut tokens = vec![email.clone()];
    if let Some((user, domain)) = email.split_once('@') {
        if !user.is_empty() {
            tokens.push(user.to_string());
        }
        if !domain.is_empty() {
            tokens.push(domain.to_string());
            if let Some((name, _tld)) = domain.split_once('.') {
                if !name.is_empty() {
                    tokens.push(name.to_string());
                }
            }
        }
    }
    tokens.sort();
    tokens.dedup();
    tokens
}

/// Токены телефонов: строка цифр целиком, последние 4 и последние 7 цифр.
pub fn phone_tokens(phones: &[Option<&str>]) -> Vec<String> {
    let mut tokens = Vec::new();
    for phone in phones.iter().flatten() {
        let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
        let len = digits.len();
        if len >= 2 {
            tokens.push(digits.clone());
        }
        if len > 4 {
            tokens.push(digits[len - 4..].to_string());
        }
        if len > 7 {
            tokens.push(digits[len - 7..].to_string());
        }
    }
    tokens.sort();
    tokens.dedup();
    tokens
}

/// Строка FTS5 MATCH-запроса: каждое слово — префиксное совпадение
/// по исходному и транспонированным раскладкам, слова соединяются через AND.
///
/// Возвращает `None`, если в запросе нет ни одного значимого слова.
pub fn build_fts_query(query: &str) -> Option<String> {
    const MAX_WORDS: usize = 8;

    let mut clauses: Vec<String> = Vec::new();
    for word in query.split_whitespace().take(MAX_WORDS) {
        let cleaned: String = word
            .chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect();
        if cleaned.is_empty() {
            continue;
        }

        let mut variants = vec![cleaned.clone()];
        for candidate in [to_ru_layout(&cleaned), to_en_layout(&cleaned)] {
            if !candidate.is_empty() && !variants.contains(&candidate) {
                variants.push(candidate);
            }
        }

        // Токены содержат только буквы/цифры, поэтому кавычки FTS5 безопасны.
        let ors = variants
            .iter()
            .map(|v| format!("\"{v}\"*"))
            .collect::<Vec<_>>()
            .join(" OR ");
        clauses.push(format!("({ors})"));
    }

    if clauses.is_empty() {
        None
    } else {
        Some(clauses.join(" AND "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transliterates_both_ways() {
        // i→ш v→м a→ф n→т o→щ v→м
        assert_eq!(to_ru_layout("ivanov"), "шмфтщм");
        assert_eq!(to_en_layout(&to_ru_layout("petrov")), "petrov");
        // Символы вне раскладки сохраняются.
        assert_eq!(to_ru_layout("123"), "123");
    }

    #[test]
    fn builds_initials() {
        assert_eq!(initials_tokens("Иванов Иван Иванович"), vec!["ии", "иии"]);
        assert_eq!(initials_tokens("Смирнова Анна"), vec!["са"]);
        // Одиночное слово — значимых инициалов нет.
        assert!(initials_tokens("Иванов").is_empty());
    }

    #[test]
    fn builds_email_tokens() {
        let tokens = email_tokens("Ivanov@KMAruda.RU");
        assert!(tokens.contains(&"ivanov@kmaruda.ru".to_string()));
        assert!(tokens.contains(&"ivanov".to_string()));
        assert!(tokens.contains(&"kmaruda.ru".to_string()));
        assert!(tokens.contains(&"kmaruda".to_string()));
    }

    #[test]
    fn builds_phone_tokens_with_tails() {
        let tokens = phone_tokens(&[Some("+7 (495) 123-45-67"), None, Some("1234")]);
        assert!(tokens.contains(&"74951234567".to_string()));
        assert!(tokens.contains(&"4567".to_string()));
        assert!(tokens.contains(&"1234567".to_string()));
        assert!(tokens.contains(&"1234".to_string()));
    }

    #[test]
    fn fts_query_expands_layouts_and_prefixes() {
        let q = build_fts_query("Иван 4567").expect("non-empty query");
        assert!(q.contains("\"иван\"*"));
        assert!(q.contains("\"4567\"*"));
        assert!(q.contains(" AND "));
    }

    #[test]
    fn fts_query_is_none_for_garbage() {
        assert!(build_fts_query("   ").is_none());
        assert!(build_fts_query("!!! ???").is_none());
    }

    #[test]
    fn fts_query_strips_special_characters() {
        // Кавычки и операторы FTS5 не должны проникать в запрос.
        let q = build_fts_query("\"abc\" OR x:y").expect("query");
        assert!(!q.contains(":"));
        // Все кавычки — только парные обрамления токенов.
        assert_eq!(q.matches('"').count() % 2, 0);
    }
}
