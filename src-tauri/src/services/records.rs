//! Нормализация сырых LDAP-записей в строки локального кэша.
//!
//! Чистая логика без зависимости от Tauri: `RawUser` → `UserRecord`.
//! Здесь же разрешается DN руководителя в его displayName и вычисляются
//! поисковые токены.

use std::collections::HashMap;

use crate::services::db::UserRecord;
use crate::services::ldap::RawUser;
use crate::services::tokens;

/// Нормализация выборки LDAP одной организации.
///
/// * отключённые учётки (бит ACCOUNTDISABLE в `userAccountControl`)
///   отбрасываются: уволенные и архивные не попадают ни в выдачу, ни в
///   справочник имён руководителей — вторая линия обороны после
///   LDAP-фильтра поиска;
/// * `manager` (DN) заменяется на displayName руководителя;
/// * `company` берётся из AD как есть: если атрибут пуст (сервисные
///   учётки и т.п.), организация остаётся незаполненной — название
///   организации из конфига НЕ подставляется;
/// * вычисляются ключ сортировки и поисковые токены.
pub fn build_records(raw_users: Vec<RawUser>) -> Vec<UserRecord> {
    let raw_users: Vec<RawUser> = raw_users
        .into_iter()
        .filter(|user| !user.is_account_disabled())
        .collect();
    let mut names_by_dn: HashMap<String, String> = HashMap::with_capacity(raw_users.len());
    for user in &raw_users {
        if let Some(name) = user
            .display_name
            .as_deref()
            .or(user.sam_account_name.as_deref())
            .filter(|name| !name.trim().is_empty())
        {
            names_by_dn.insert(user.dn.to_lowercase(), name.trim().to_string());
        }
    }

    raw_users
        .into_iter()
        .map(|user| {
            let display_name = user
                .display_name
                .clone()
                .or_else(|| compose_full_name(&user))
                .or_else(|| user.sam_account_name.clone())
                .unwrap_or_else(|| cn_from_dn(&user.dn));

            let manager = user.manager_dn.as_ref().map(|dn| {
                names_by_dn
                    .get(&dn.to_lowercase())
                    .cloned()
                    .unwrap_or_else(|| cn_from_dn(dn))
            });

            let company = user
                .company
                .as_deref()
                .map(tokens::collapse_spaces)
                .filter(|company| !company.is_empty());

            // TrueConf ID сотрудника хранится в AD-атрибуте pager:
            // обрезаем пробелы, пустые значения не сохраняем.
            let pager = user
                .pager
                .as_deref()
                .map(str::trim)
                .filter(|pager| !pager.is_empty())
                .map(str::to_string);

            let mut token_parts = tokens::initials_tokens(&display_name);
            if let Some(email) = user.email.as_deref() {
                token_parts.extend(tokens::email_tokens(email));
            }
            token_parts.extend(tokens::phone_tokens(&[
                user.ip_phone.as_deref(),
                user.phone_external.as_deref(),
                user.phone_mobile.as_deref(),
            ]));
            if let Some(sam) = user.sam_account_name.as_deref() {
                token_parts.push(sam.to_lowercase());
            }

            let sort_key = tokens::sort_key(&display_name);
            UserRecord {
                object_guid: user.object_guid,
                sam_account_name: user.sam_account_name,
                first_name: user.first_name,
                last_name: user.last_name,
                middle_name: user.middle_name,
                display_name,
                sort_key,
                title: user.title,
                department: user.department,
                company,
                office: user.office,
                email: user.email,
                ip_phone: user.ip_phone,
                phone_external: user.phone_external,
                phone_mobile: user.phone_mobile,
                manager,
                pager,
                usn_changed: user.usn_changed,
                tokens: token_parts.join(" "),
            }
        })
        .collect()
}

/// «Фамилия Имя Отчество» из компонент, если `displayName` пуст.
pub fn compose_full_name(user: &RawUser) -> Option<String> {
    let parts: Vec<&str> = [
        user.last_name.as_deref(),
        user.first_name.as_deref(),
        user.middle_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|part| !part.is_empty())
    .collect();
    (!parts.is_empty()).then(|| parts.join(" "))
}

/// Извлекает CN из DN: `CN=Иванов И.И.,OU=IT,DC=x` → `Иванов И.И.`
/// Учитывает экранированные разделители (`\,`, `\+`).
pub fn cn_from_dn(dn: &str) -> String {
    let mut rdn = String::new();
    let mut escaped = false;
    for ch in dn.chars() {
        if escaped {
            rdn.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            ',' | '+' => break,
            _ => rdn.push(ch),
        }
    }
    let rdn = rdn.trim();
    match rdn.split_once('=') {
        Some((_, value)) => value.trim().to_string(),
        None => rdn.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw_user(guid: &str, display: Option<&str>, sam: Option<&str>) -> RawUser {
        RawUser {
            dn: format!("CN={},OU=Staff,DC=kmaruda,DC=ru", display.unwrap_or(guid)),
            object_guid: guid.into(),
            sam_account_name: sam.map(str::to_string),
            first_name: None,
            last_name: None,
            middle_name: None,
            display_name: display.map(str::to_string),
            title: None,
            department: Some("IT".into()),
            company: None,
            office: None,
            email: Some(format!("{guid}@kmaruda.ru")),
            ip_phone: Some("1234".into()),
            phone_external: None,
            phone_mobile: None,
            manager_dn: Some("CN=Петров П.П.,OU=Staff,DC=kmaruda,DC=ru".into()),
            pager: None,
            user_account_control: None,
            usn_changed: None,
        }
    }

    #[test]
    fn extracts_cn_from_dn() {
        assert_eq!(
            cn_from_dn("CN=Иванов И.И.,OU=IT,DC=kmaruda,DC=ru"),
            "Иванов И.И."
        );
        assert_eq!(cn_from_dn(r"CN=Smith\, John,DC=x"), "Smith, John");
        assert_eq!(cn_from_dn("OU=IT"), "IT");
        assert_eq!(cn_from_dn(""), "");
    }

    #[test]
    fn builds_records_with_manager_resolution_and_defaults() {
        let mut manager = raw_user("g2", Some("Петров П.П."), Some("petrov"));
        manager.manager_dn = None;
        let mut users = vec![raw_user("g1", Some("Иванов Иван"), Some("ivanov")), manager];

        // У третьего пользователя company заполнена «грязно» — проверяем нормализацию.
        let mut with_company = raw_user("g3", Some("Сидоров С.С."), Some("sidorov"));
        with_company.company = Some("  ООО   Ромашка ".into());
        users.push(with_company);

        let records = build_records(users);
        assert_eq!(records.len(), 3);

        let ivanov = &records[0];
        assert_eq!(
            ivanov.manager.as_deref(),
            Some("Петров П.П."),
            "DN руководителя заменён на имя"
        );
        assert_eq!(
            ivanov.company, None,
            "пустая company остаётся пустой (сервисные учётки)"
        );
        assert_eq!(ivanov.sort_key, "иванов иван");
        assert!(
            ivanov.tokens.contains("ии"),
            "токены инициалов присутствуют: {}",
            ivanov.tokens
        );
        assert!(ivanov.tokens.contains("g1@kmaruda.ru"));
        assert!(ivanov.tokens.contains("1234"));

        let petrov = &records[1];
        assert_eq!(petrov.manager, None);

        let sidorov = &records[2];
        assert_eq!(
            sidorov.company.as_deref(),
            Some("ООО Ромашка"),
            "реальная company сохранена с нормализованными пробелами"
        );
    }

    #[test]
    fn blank_company_becomes_none() {
        let mut user = raw_user("g4", Some("Тест Т.Т."), Some("test"));
        user.company = Some("   ".into());
        let records = build_records(vec![user]);
        assert_eq!(records[0].company, None, "пробельная company → None");
    }

    #[test]
    fn pager_carried_as_trueconf_id() {
        let mut user = raw_user("g5", Some("Тест Т.Т."), Some("test"));
        user.pager = Some("  malakhov@kma-meet.metholding.com  ".into());
        let records = build_records(vec![user]);
        assert_eq!(
            records[0].pager.as_deref(),
            Some("malakhov@kma-meet.metholding.com"),
            "TrueConf ID (AD pager) триммируется и прокидывается в запись"
        );

        let mut empty = raw_user("g6", Some("Пустой П.П."), Some("empty"));
        empty.pager = Some("   ".into());
        let records = build_records(vec![empty]);
        assert_eq!(records[0].pager, None, "пустой pager → None");
    }

    #[test]
    fn disabled_accounts_are_skipped_entirely() {
        // Отключённая учётка (уволенный сотрудник) не попадает ни в выдачу,
        // ни в справочник имён руководителей, даже если контроллер домена
        // вернул её вопреки фильтру поиска.
        let mut dismissed = raw_user("g7", Some("Уволенный У.У."), Some("dismissed"));
        dismissed.user_account_control = Some(0x202); // NORMAL_ACCOUNT + ACCOUNTDISABLE
        let mut manager_disabled = raw_user("g8", Some("Начальник Н.Н."), Some("boss_old"));
        manager_disabled.manager_dn = None;
        manager_disabled.user_account_control = Some(2);

        let records = build_records(vec![
            raw_user("g1", Some("Иванов Иван"), Some("ivanov")),
            dismissed,
            manager_disabled,
        ]);
        assert_eq!(records.len(), 1, "отключённые учётки отброшены");
        assert_eq!(records[0].sam_account_name.as_deref(), Some("ivanov"));
    }

    #[test]
    fn enabled_account_flags_do_not_disable_user() {
        // Обычные флаги (NORMAL_ACCOUNT, DONT_EXPIRE_PASSWORD) — не отключение.
        let mut user = raw_user("g9", Some("Работающий Р.Р."), Some("active"));
        user.user_account_control = Some(0x10000 | 0x40);
        let records = build_records(vec![user]);
        assert_eq!(records.len(), 1);
    }

    #[test]
    fn display_name_fallbacks() {
        let no_display = raw_user("g3", None, Some("sidorov"));
        let records = build_records(vec![no_display]);
        assert_eq!(records[0].display_name, "sidorov");
    }
}
