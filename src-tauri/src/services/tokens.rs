//! Building search tokens and FTS queries.
//!
//! The module contains only pure functions - it is fully covered by unit tests
//! and does not depend on Tauri/the database.
//!
//! Domain specifics:
//! * Users often type Russian names while forgetting to switch the keyboard layout
//!   ("'shluktshy" instead of "direktor"), so each query token is expanded
//!   into three variants: original, QWERTY->Russian, and Russian->QWERTY.
//! * Phones are searched by number "tails" (last 4 and 7 digits):
//!   the internal number is requested by its short tail, not the full number.
//! * SQLite `lower()`/`NOCASE` do not work with Cyrillic, so the key
//!   sort key (`sort_key`) is computed on the Rust side.

/// QWERTY -> JCUKEN mapping (PC layout).
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

/// Convert a string to the Russian layout: `ivanov` -> `shtfmpd`.
pub fn to_ru_layout(input: &str) -> String {
    map_layout(input, true)
}

/// Convert a string to the English layout: `ivanov` -> `bdfyjd`.
pub fn to_en_layout(input: &str) -> String {
    map_layout(input, false)
}

/// Whitespace normalization: trimming + collapsing repeats
/// ("OOO  KMAruda" -> "OOO KMAruda").
pub fn collapse_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Organization deduplication key: normalized whitespace + lowercase.
/// Computed in Rust because SQLite `lower()` does not know Cyrillic.
pub fn company_key(value: &str) -> String {
    collapse_spaces(value).to_lowercase()
}

/// Sort key: unicode-lowercase (including Cyrillic).
pub fn sort_key(display_name: &str) -> String {
    display_name.to_lowercase()
}

/// Initial tokens: "Ivanov Ivan Ivanovich" -> `["iii", "ii"]`.
/// Single initials are discarded - otherwise the FTS index drowns in garbage.
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

/// Email tokens: the whole address, local part, domain, domain without TLD.
pub fn email_tokens(email: &str) -> Vec<String> {
    let email = email.trim().to_lowercase();
    if email.is_empty() {
        return Vec::new();
    }
    let mut tokens = vec![email.clone()];
    if let Some((user, domain)) = email.split_once('@') {
        if !user.is_empty() {
            tokens.push(user.to_string());
            // unicode61 may consider "_"/"-" part of a token; we add
            // parts explicitly, so the query "grachev_ke@..." finds the address.
            for part in user.split(['_', '-', '+', '.']) {
                if !part.is_empty() {
                    tokens.push(part.to_string());
                }
            }
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

/// Phone tokens: the whole digit string, the last 4 and the last 7 digits.
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

/// FTS5 MATCH query string: each word is a prefix match
/// by the original and transposed layouts; words are joined with AND.
///
/// Returns `None` if the query has no meaningful words.
pub fn build_fts_query(query: &str) -> Option<String> {
    const MAX_WORDS: usize = 8;

    let mut clauses: Vec<String> = Vec::new();
    for word in query.split_whitespace().take(MAX_WORDS) {
        // E-mail is not a single FTS token: unicode61 splits the address by "@", ".",
        // "_", "-" and "+". We split it into parts and require them all (clauses
        // joined with AND); otherwise "grachev_ke" (without @) or
        // "grachev_ke@…" would be glued into one token and would not find the email.
        let parts: Vec<&str> = word
            .split(['@', '.', '_', '-', '+'])
            .filter(|part| !part.is_empty())
            .collect();
        if parts.len() > 1 {
            for part in parts {
                push_fts_clause(&mut clauses, part);
            }
        } else {
            push_fts_clause(&mut clauses, word);
        }
    }

    if clauses.is_empty() {
        None
    } else {
        Some(clauses.join(" AND "))
    }
}

/// Adds an AND clause for one query word, considering keyboard layouts.
fn push_fts_clause(clauses: &mut Vec<String>, word: &str) {
    let normalize = |value: &str| -> String {
        value
            .chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect()
    };

    // Layout variants are built BEFORE dropping punctuation:
    // a comma on the Russian layout is "b", a dot is "yu", and the user,
    // typing `,j,f`, searches for "boba", not "oa". After conversion we take
    // only letters and digits - punctuation has no place in FTS tokens.
    let mut variants: Vec<String> = Vec::new();
    for candidate in [word, &to_ru_layout(word), &to_en_layout(word)] {
        let candidate = normalize(candidate);
        if !candidate.is_empty() && !variants.contains(&candidate) {
            variants.push(candidate);
        }
    }
    if variants.is_empty() {
        return;
    }

    // Tokens contain only letters/digits, so FTS5 quoting is safe.
    let ors = variants
        .iter()
        .map(|v| format!("\"{v}\"*"))
        .collect::<Vec<_>>()
        .join(" OR ");
    clauses.push(format!("({ors})"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transliterates_both_ways() {
        // i->sh v->m a->f n->t o->shch v->m
        assert_eq!(to_ru_layout("ivanov"), "шмфтщм");
        assert_eq!(to_en_layout(&to_ru_layout("petrov")), "petrov");
        // Characters outside the layout are preserved.
        assert_eq!(to_ru_layout("123"), "123");
    }

    #[test]
    fn builds_initials() {
        assert_eq!(initials_tokens("Иванов Иван Иванович"), vec!["ии", "иии"]);
        assert_eq!(initials_tokens("Смирнова Анна"), vec!["са"]);
        // A single word — no meaningful initials.
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
        // Quotes and FTS5 operators must not penetrate the query.
        let q = build_fts_query("\"abc\" OR x:y").expect("query");
        assert!(!q.contains(":"));
        // All quotes are only paired token wrappers.
        assert_eq!(q.matches('"').count() % 2, 0);
    }

    #[test]
    fn fts_query_splits_email_into_searchable_tokens() {
        // The whole address is not a single FTS token: unicode61 splits it
        // at "@" and ".". Therefore the query must require all parts of the address,
        // otherwise "ivanov@kmaruda.ru" would collapse into "ivanovkmarudaru" and
        // would find neither the email column nor the tokens.
        let q = build_fts_query("Ivanov@KMAruda.RU").expect("email query");
        assert!(q.contains("\"ivanov\"*"), "{q}");
        assert!(q.contains("\"kmaruda\"*"), "{q}");
        assert!(q.contains("\"ru\"*"), "{q}");
        assert!(!q.contains("ivanovkmarudaru"), "{q}");

        // An underscore in the local part is also a unicode61 separator.
        let q = build_fts_query("Grachev_ke@metholding.com").expect("underscore email");
        assert!(q.contains("\"grachev\"*"), "{q}");
        assert!(q.contains("\"ke\"*"), "{q}");
        assert!(q.contains("\"metholding\"*"), "{q}");
        assert!(!q.contains("grachevke"), "{q}");
    }

    #[test]
    fn fts_query_splits_email_local_part_without_at() {
        // The user often types only the beginning of an address, without "@".
        let q = build_fts_query("grachev_ke").expect("email local part");
        assert!(q.contains("\"grachev\"*"), "{q}");
        assert!(q.contains("\"ke\"*"), "{q}");
        assert!(!q.contains("grachevke"), "{q}");
    }
}
