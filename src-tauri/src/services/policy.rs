//! Правила принятия решений о синхронизации (чистая логика, без Tauri).

use crate::services::config::{AppConfig, LdapOrgConfig};
use crate::services::db::{unix_now, Db};

/// Организация считается настроенной, если указаны сервер и Base DN.
pub fn is_configured(org: &LdapOrgConfig) -> bool {
    !org.ldap_url.trim().is_empty() && !org.base_dn.trim().is_empty()
}

/// Нужна ли фоновая синхронизация:
/// есть валидные подключения И (кэш пуст ИЛИ любая организация
/// не синхронизирована / её кэш старше `sync_interval_hours`).
pub fn needs_sync(db: &Db, config: &AppConfig) -> bool {
    if config.test_mode {
        return false;
    }
    let configured: Vec<&LdapOrgConfig> = config
        .ldap_configs
        .iter()
        .filter(|org| is_configured(org))
        .collect();
    if configured.is_empty() {
        return false;
    }
    if db.count().unwrap_or(0) == 0 {
        return true;
    }

    let interval_secs = i64::from(config.sync_interval_hours.clamp(1, 168)) * 3600;
    let metas = db.sync_meta().unwrap_or_default();
    let now = unix_now();

    configured.iter().any(|org| {
        match metas
            .iter()
            .find(|meta| meta.organization == org.organization)
        {
            None => true,
            Some(meta) => meta
                .last_sync_at
                .is_none_or(|synced_at| now.saturating_sub(synced_at) >= interval_secs),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::db::UserRecord;

    fn config_with_org(url: &str, base: &str) -> AppConfig {
        AppConfig {
            ldap_configs: vec![LdapOrgConfig {
                organization: "Org".into(),
                ldap_url: url.into(),
                base_dn: base.into(),
                bind_dn: None,
                use_start_tls: false,
                allow_invalid_tls: false,
                use_integrated_auth: true,
                has_password: false,
            }],
            ..Default::default()
        }
    }

    fn record(guid: &str) -> UserRecord {
        UserRecord {
            object_guid: guid.into(),
            sam_account_name: None,
            first_name: None,
            last_name: None,
            middle_name: None,
            display_name: "Иванов".into(),
            sort_key: "иванов".into(),
            title: None,
            department: None,
            company: Some("Org".into()),
            office: None,
            email: None,
            ip_phone: None,
            phone_external: None,
            phone_mobile: None,
            manager: None,
            manager_guid: None,
            pager: None,
            usn_changed: None,
            tokens: String::new(),
        }
    }

    #[test]
    fn needs_sync_on_empty_cache() {
        let db = Db::open_in_memory().expect("db");
        assert!(needs_sync(&db, &config_with_org("ldap://dc", "DC=x")));
    }

    #[test]
    fn no_sync_after_fresh_sync() {
        let db = Db::open_in_memory().expect("db");
        db.replace_org_users("Org", &[record("g1")]).expect("sync");
        assert!(!needs_sync(&db, &config_with_org("ldap://dc", "DC=x")));
    }

    #[test]
    fn no_sync_without_configuration() {
        let db = Db::open_in_memory().expect("db");
        assert!(!needs_sync(&db, &AppConfig::default()));
        assert!(
            !needs_sync(&db, &config_with_org("", "DC=x")),
            "пустой URL — не настроено"
        );
    }

    #[test]
    fn no_sync_in_test_mode() {
        let db = Db::open_in_memory().expect("db");
        let config = AppConfig {
            test_mode: true,
            ..config_with_org("ldap://dc", "DC=x")
        };
        assert!(!needs_sync(&db, &config));
    }

    #[test]
    fn syncs_when_interval_expired() {
        let db = Db::open_in_memory().expect("db");
        db.replace_org_users("Org", &[record("g1")]).expect("sync");

        // Искусственно «состариваем» отметку синхронизации.
        {
            let conn = std::sync::Arc::clone(db.conn_for_tests());
            let guard = conn.lock().expect("lock");
            guard
                .execute(
                    "UPDATE sync_meta SET last_sync_at = ?1
                     WHERE source_id = (SELECT id FROM sources WHERE name = 'Org')",
                    [unix_now() - 48 * 3600],
                )
                .expect("update");
        }

        let config = AppConfig {
            sync_interval_hours: 24,
            ..config_with_org("ldap://dc", "DC=x")
        };
        assert!(
            needs_sync(&db, &config),
            "кэш старше интервала — нужна синхронизация"
        );
    }
}
