//! Application configuration and secret store.
//!
//! Principles:
//! * `config.json` is written atomically (temp file + rename) - corruption
//!   impossible even on power loss.
//! * LDAP bind account passwords **never** end up in `config.json`,
//!   nor into the frontend. They are stored in the system secret store
//!   (Windows Credential Manager / macOS Keychain / Secret Service),
//!   while the configuration carries only the `hasPassword` flag.
//! * When an organization is deleted, its secret is guaranteed to be removed from the keyring.
mod embedded;
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
        // An old-format config: no new fields — serialization must not fail.
        let json = r#"{ "theme": "dark", "language": "en" }"#;
        let config: AppConfig = serde_json::from_str(json).expect("parse");
        assert_eq!(config.theme, "dark");
        assert_eq!(config.language, "en");
        assert!(!config.global_mode);
        assert!(config.ldap_configs.is_empty());
        assert_eq!(config.sync_interval_hours, 24);
        assert!(config.animations_enabled);
        assert!(config.show_avatars);
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
        // Is the LDAP URL case-insensitive in the scheme? We require a strict prefix —
        // therefore uppercase must be rejected.
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
        assert_eq!(normalize_language("de"), "en");
    }

    #[cfg(feature = "embedded-config")]
    fn managed_temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kma-embedded-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[cfg(feature = "embedded-config")]
    #[test]
    fn managed_profile_overlays_admin_fields_and_keeps_user_fields() {
        let dir = managed_temp_dir();
        let path = dir.join("config.json");
        fs::write(
            &path,
            serde_json::json!({
                "theme": "light",
                "language": "ru",
                "savedContactIds": ["saved-1"],
                "ldapConfigs": [],
                "orgGroups": [],
                "enterpriseGroupId": null
            })
            .to_string(),
        )
        .expect("write local config");

        let config = ConfigStore::load(&dir).expect("load");
        assert!(config.managed);
        assert_eq!(config.managed_profile.as_deref(), Some("test-profile"));
        assert_eq!(config.managed_revision, Some(7));
        assert_eq!(config.theme, "light");
        assert_eq!(config.language, "ru");
        assert_eq!(config.saved_contact_ids, vec!["saved-1".to_string()]);
        assert_eq!(config.ldap_configs[0].organization, "Test KMAruda");
        assert_eq!(
            config.enterprise_group_id.as_deref(),
            Some("embedded-test-group")
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(feature = "embedded-config")]
    #[test]
    fn save_cannot_override_managed_fields() {
        let dir = managed_temp_dir();
        let request: SaveConfigRequest = serde_json::from_value(serde_json::json!({
            "theme": "dark",
            "language": "en",
            "ldapConfigs": [{
                "organization": "Local override",
                "ldapUrl": "ldap://local.test",
                "baseDn": "DC=local,DC=test",
                "useIntegratedAuth": true
            }],
            "orgGroups": [],
            "enterpriseGroupId": null
        }))
        .expect("request");

        let saved = ConfigStore::save(&dir, request).expect("save");
        assert!(saved.managed);
        assert_eq!(saved.ldap_configs[0].organization, "Test KMAruda");
        assert_eq!(saved.theme, "dark", "user theme is local");

        let disk = ConfigStore::load_from_disk(&ConfigStore::config_path(&dir));
        assert!(!disk.managed, "managed flag is runtime-only");
        assert_eq!(disk.ldap_configs[0].organization, "Test KMAruda");
        let _ = fs::remove_dir_all(&dir);
    }
}
