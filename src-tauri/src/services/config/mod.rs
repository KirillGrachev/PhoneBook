//! Конфигурация приложения и хранилище секретов.
//!
//! Принципы:
//! * `config.json` пишется атомарно (temp-файл + rename) — повреждение
//!   невозможно даже при обрыве питания.
//! * Пароли bind-учёток LDAP **никогда** не попадают ни в `config.json`,
//!   ни во фронтенд. Они хранятся в системном хранилище секретов
//!   (Windows Credential Manager / macOS Keychain / Secret Service),
//!   а конфигурация несёт только флаг `hasPassword`.
//! * При удалении организации её секрет гарантированно удаляется из keyring.
mod model;
pub(crate) mod share;
pub(crate) mod store;
mod validate;

pub use model::{AppConfig, LdapOrgConfig, LdapOrgInput, SaveConfigRequest};
pub use share::{ConfigShareFile, OrgGroupsShareFile, CONFIG_SHARE_FILE_NAME, SHARE_FILE_NAME};
pub use store::ConfigStore;

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::error::AppError;

    use super::validate::{normalize_language, normalize_theme, validate_orgs};
    use super::*;

    #[test]
    fn defaults_are_applied_to_partial_json() {
        // Конфиг старого формата: новых полей нет — сериализация не должна падать.
        let json = r#"{ "theme": "dark", "language": "en" }"#;
        let config: AppConfig = serde_json::from_str(json).expect("parse");
        assert_eq!(config.theme, "dark");
        assert_eq!(config.language, "en");
        assert!(!config.global_mode);
        assert!(config.ldap_configs.is_empty());
        assert_eq!(config.sync_interval_hours, 24);
        assert!(config.animations_enabled);
    }

    #[test]
    fn corrupt_json_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join(format!("kma-cfg-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("config.json");
        fs::write(&path, "{ not json !!").expect("write");

        let config = ConfigStore::load_from_disk(&path);
        assert_eq!(config.theme, "system");
        assert!(path.with_extension("json.corrupt").exists(), "бэкап создан");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validates_org_inputs() {
        let ok = validate_orgs(vec![LdapOrgInput {
            organization: "  КМАруда ".into(),
            ldap_url: "LDAP://dc1.kmaruda.ru".into(),
            base_dn: " DC=kmaruda,DC=ru ".into(),
            bind_dn: Some("  ".into()),
            use_start_tls: false,
            allow_invalid_tls: false,
            use_integrated_auth: true,
        }]);
        // LDAP URL регистронезависим по схеме? Мы требуем строгий префикс —
        // поэтому uppercase должен быть отклонён.
        assert!(ok.is_err(), "схема в верхнем регистре отклоняется");

        let ok = validate_orgs(vec![LdapOrgInput {
            organization: "  КМАруда ".into(),
            ldap_url: "ldap://dc1.kmaruda.ru".into(),
            base_dn: " DC=kmaruda,DC=ru ".into(),
            bind_dn: Some("  ".into()),
            use_start_tls: false,
            allow_invalid_tls: false,
            use_integrated_auth: true,
        }])
        .expect("valid");
        assert_eq!(ok[0].organization, "КМАруда");
        assert_eq!(ok[0].base_dn, "DC=kmaruda,DC=ru");
        assert_eq!(ok[0].bind_dn, None, "пустой bind_dn нормализуется в None");

        let dup = validate_orgs(vec![
            LdapOrgInput {
                organization: "Org".into(),
                ldap_url: String::new(),
                base_dn: String::new(),
                bind_dn: None,
                use_start_tls: false,
                allow_invalid_tls: false,
                use_integrated_auth: true,
            },
            LdapOrgInput {
                organization: "org".into(),
                ldap_url: String::new(),
                base_dn: String::new(),
                bind_dn: None,
                use_start_tls: false,
                allow_invalid_tls: false,
                use_integrated_auth: true,
            },
        ]);
        assert!(
            matches!(dup, Err(AppError::Validation(_))),
            "дубликаты отклоняются"
        );
    }

    #[test]
    fn normalizes_theme_and_language() {
        assert_eq!(normalize_theme("dark"), "dark");
        assert_eq!(normalize_theme("hacker"), "system");
        assert_eq!(normalize_language("en"), "en");
        assert_eq!(normalize_language("de"), "ru");
    }
}
