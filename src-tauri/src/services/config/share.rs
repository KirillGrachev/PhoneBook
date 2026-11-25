//! Settings exchange files: transferring configuration between machines.
//!
//! Organization groups and all configuration live in the local `config.json`
//! (the SQLite cache is only a recoverable mirror of AD). Exchange files are a way
//! transfer these settings to another PC: export writes them to "Documents",
//! import reads and validates the format before applying it.
//!
//! The formats are self-documenting and versioned: the `format` marker protects against
//! accidental import of foreign JSON; `version` - against future-format files.
//! Secrets (LDAP passwords) never leave the machine in any format.

use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

use super::model::{AppConfig, OrgGroup};

/// Format marker: importing foreign JSON is rejected with a clear error.
pub const SHARE_FORMAT: &str = "kmaruda-phonebook/org-groups";
/// Current format version.
pub const SHARE_VERSION: u32 = 1;
/// File name suggested when exporting.
pub const SHARE_FILE_NAME: &str = "kmaruda-org-groups.json";

/// Contents of the organization group exchange file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgGroupsShareFile {
    /// Format marker ([`SHARE_FORMAT`]).
    pub format: String,
    /// Format version ([`SHARE_VERSION`]).
    pub version: u32,
    /// Export moment (unix seconds): a reference field for the recipient.
    #[serde(default)]
    pub exported_at: Option<i64>,
    /// Organization groups (union filters).
    pub groups: Vec<OrgGroup>,
    /// Group mark for the "KMAruda" tab on the source machine. May
    /// point to a group the recipient does not have after merging - then
    /// the mark is ignored; someone else's tab is not broken.
    #[serde(default)]
    pub enterprise_group_id: Option<String>,
}

impl OrgGroupsShareFile {
    /// Build an exchange file from the current configuration.
    pub fn new(groups: Vec<OrgGroup>, enterprise_group_id: Option<String>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);
        Self {
            format: SHARE_FORMAT.to_string(),
            version: SHARE_VERSION,
            exported_at: Some(now),
            groups,
            enterprise_group_id,
        }
        .normalized()
    }

    /// Parse and validate the exchange file contents.
    pub fn parse(content: &str) -> Result<Self, AppError> {
        #[derive(Deserialize)]
        struct FormatProbe {
            #[serde(default)]
            format: Option<String>,
        }

        // The Organization groups screen is also a convenient place to pick a
        // full configuration export. Accept it and take only its groups
        // instead of failing with a confusing "missing field `groups`".
        if let Ok(probe) = serde_json::from_str::<FormatProbe>(content) {
            if probe.format.as_deref() == Some(CONFIG_SHARE_FORMAT) {
                let config = ConfigShareFile::parse(content)?;
                return Ok(Self::new(config.org_groups, config.enterprise_group_id));
            }
        }

        let file: Self = serde_json::from_str(content).map_err(|e| {
            AppError::Validation(format!(
                "Файл групп организаций не является корректным JSON: {e}"
            ))
        })?;
        file.validate()?;
        Ok(file.normalized())
    }

    /// Format check: marker, version, group integrity.
    pub fn validate(&self) -> Result<(), AppError> {
        if self.format != SHARE_FORMAT {
            return Err(AppError::Validation(format!(
                "Это не файл групп организаций KMAruda PhoneBook (неизвестный формат «{}»)",
                self.format
            )));
        }
        if self.version > SHARE_VERSION {
            return Err(AppError::Validation(format!(
                "Файл групп организаций создан более новой версией приложения (версия формата {} > {})",
                self.version, SHARE_VERSION
            )));
        }
        let mut ids: HashSet<&str> = HashSet::new();
        let mut names: HashSet<String> = HashSet::new();
        for group in &self.groups {
            if group.id.trim().is_empty() || group.name.trim().is_empty() {
                return Err(AppError::Validation(
                    "В файле групп организаций есть группа без названия или идентификатора".into(),
                ));
            }
            if !ids.insert(group.id.as_str()) {
                return Err(AppError::Validation(format!(
                    "В файле групп организаций дублируется идентификатор группы «{}»",
                    group.name
                )));
            }
            if !names.insert(group.name.trim().to_lowercase()) {
                return Err(AppError::Validation(format!(
                    "В файле групп организаций дублируется название «{}»",
                    group.name
                )));
            }
        }
        Ok(())
    }

    /// Normalized form: whitespace trimmed, empty organizations removed,
    /// organization duplicates within the group are collapsed.
    pub fn normalized(&self) -> Self {
        let mut clone = self.clone();
        for group in &mut clone.groups {
            group.name = group.name.trim().to_string();
            let mut seen: HashSet<String> = HashSet::new();
            group.orgs = group
                .orgs
                .iter()
                .map(|org| org.trim().to_string())
                .filter(|org| !org.is_empty())
                .filter(|org| seen.insert(org.clone()))
                .collect();
        }
        clone
    }

    /// Pretty JSON for writing to the exchange file.
    pub fn render(&self) -> Result<String, AppError> {
        serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Internal(format!("сериализация групп: {e}")))
    }
}

/// Configuration exchange file format marker.
pub const CONFIG_SHARE_FORMAT: &str = "kmaruda-phonebook/config";
/// Current version of the configuration exchange file format.
pub const CONFIG_SHARE_VERSION: u32 = 1;
/// File name suggested when exporting configuration.
pub const CONFIG_SHARE_FILE_NAME: &str = "kmaruda-config.json";

/// Configuration exchange file: full transfer of settings to another PC
/// (appearance, AD connections without secrets, groups, external phone file).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigShareFile {
    /// Format marker ([`CONFIG_SHARE_FORMAT`]).
    pub format: String,
    /// Format version ([`CONFIG_SHARE_VERSION`]).
    pub version: u32,
    /// Export moment (unix seconds): a reference field for the recipient.
    #[serde(default)]
    pub exported_at: Option<i64>,
    /// Rollout profile name (optional; for embedded builds).
    #[serde(default)]
    pub profile: Option<String>,
    /// Rollout profile revision (optional; for diagnostics).
    #[serde(default)]
    pub revision: Option<u32>,
    /// Source machine configuration.
    pub config: AppConfig,
}

impl ConfigShareFile {
    /// Build an exchange file from the current configuration.
    pub fn new(config: AppConfig) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);
        Self {
            format: CONFIG_SHARE_FORMAT.to_string(),
            version: CONFIG_SHARE_VERSION,
            exported_at: Some(now),
            profile: None,
            revision: None,
            config,
        }
    }

    /// Parse and validate the exchange file contents: foreign JSON and files
    /// future versions are rejected before applying settings.
    pub fn parse(content: &str) -> Result<AppConfig, AppError> {
        let file: Self = serde_json::from_str(content).map_err(|e| {
            AppError::Config(format!(
                "Файл конфигурации не является корректным JSON: {e}"
            ))
        })?;
        if file.format != CONFIG_SHARE_FORMAT {
            return Err(AppError::Config(format!(
                "Это не файл конфигурации KMAruda PhoneBook (неизвестный формат «{}»)",
                file.format
            )));
        }
        if file.version > CONFIG_SHARE_VERSION {
            return Err(AppError::Config(format!(
                "Файл конфигурации создан более новой версией приложения (версия формата {} > {})",
                file.version, CONFIG_SHARE_VERSION
            )));
        }
        let mut config = file.config;
        // The source machine's "password saved" flag is false on this machine:
        // secrets are stored in the system store and are not transferred.
        for org in &mut config.ldap_configs {
            org.has_password = false;
        }
        Ok(config)
    }

    /// Pretty JSON for writing to the exchange file.
    pub fn render(&self) -> Result<String, AppError> {
        serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Internal(format!("сериализация конфигурации: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(id: &str, name: &str, orgs: &[&str]) -> OrgGroup {
        OrgGroup {
            id: id.into(),
            name: name.into(),
            orgs: orgs.iter().map(|org| org.to_string()).collect(),
        }
    }

    #[test]
    fn roundtrip_parse_and_render() {
        let file = OrgGroupsShareFile::new(
            vec![group("g1", " КМАруда ", &["  КМАруда ", "КМАруда", ""])]
                .into_iter()
                .collect(),
            Some("g1".into()),
        );
        let parsed = OrgGroupsShareFile::parse(&file.render().expect("render")).expect("roundtrip");
        assert_eq!(parsed, file);
        // Normalization: spaces trimmed, an organization duplicate collapsed, an empty one removed.
        assert_eq!(parsed.groups[0].name, "КМАруда");
        assert_eq!(parsed.groups[0].orgs, vec!["КМАруда".to_string()]);
        assert_eq!(parsed.format, SHARE_FORMAT);
        assert_eq!(parsed.version, SHARE_VERSION);
        assert!(parsed.exported_at.is_some());
    }

    #[test]
    fn rejects_foreign_json() {
        let err = OrgGroupsShareFile::parse(r#"{"hello": "world"}"#).expect_err("foreign");
        assert!(matches!(err, AppError::Validation(_)));
        let err = OrgGroupsShareFile::parse(r#"{"format":"other","version":1,"groups":[]}"#)
            .expect_err("other format");
        assert!(err.to_string().contains("не файл групп организаций"));
    }

    #[test]
    fn rejects_future_version_and_broken_groups() {
        let future = r#"{"format":"kmaruda-phonebook/org-groups","version":99,"groups":[]}"#;
        assert!(OrgGroupsShareFile::parse(future).is_err());

        let dup = r#"{"format":"kmaruda-phonebook/org-groups","version":1,
            "groups":[{"id":"a","name":"X","orgs":[]},{"id":"a","name":"Y","orgs":[]}]}"#;
        assert!(OrgGroupsShareFile::parse(dup).is_err());

        let blank = r#"{"format":"kmaruda-phonebook/org-groups","version":1,
            "groups":[{"id":"a","name":"  ","orgs":[]}]}"#;
        assert!(OrgGroupsShareFile::parse(blank).is_err());
    }

    #[test]
    fn accepts_full_config_export_as_groups_file() {
        let group = group("g1", "KMAruda", &["AO Kombinat KMAruda"]);
        let config = AppConfig {
            org_groups: vec![group.clone()],
            enterprise_group_id: Some("g1".into()),
            ..Default::default()
        };
        let rendered = ConfigShareFile::new(config).render().expect("render");

        let parsed = OrgGroupsShareFile::parse(&rendered).expect("config import");
        assert_eq!(parsed.groups, vec![group]);
        assert_eq!(parsed.enterprise_group_id.as_deref(), Some("g1"));
        assert_eq!(parsed.format, SHARE_FORMAT);
    }

    #[test]
    fn config_share_roundtrip_keeps_settings() {
        let config = AppConfig {
            theme: "dark".to_string(),
            show_avatars: false,
            external_phonebook_path: Some("C:\\PhoneBook\\yealink.xml".to_string()),
            external_phonebook_paths: vec![
                "C:\\PhoneBook\\yealink.xml".to_string(),
                "C:\\PhoneBook\\office.xml".to_string(),
            ],
            external_phonebook_enabled: true,
            ldap_configs: vec![super::super::model::LdapOrgConfig {
                organization: "КМАруда".to_string(),
                ldap_url: "ldaps://dc1".to_string(),
                base_dn: "dc=kmaruda,dc=ru".to_string(),
                bind_dn: None,
                use_start_tls: false,
                allow_invalid_tls: true,
                use_integrated_auth: true,
                has_password: true,
            }],
            ..Default::default()
        };

        let rendered = ConfigShareFile::new(config.clone())
            .render()
            .expect("render");
        let parsed = ConfigShareFile::parse(&rendered).expect("parse");
        assert_eq!(parsed.theme, "dark");
        assert!(!parsed.show_avatars);
        assert_eq!(
            parsed.external_phonebook_path,
            config.external_phonebook_path
        );
        assert_eq!(
            parsed.external_phonebook_paths,
            config.external_phonebook_paths
        );
        assert!(parsed.external_phonebook_enabled);
        // The secret is not transferred: the password flag is reset.
        assert!(!parsed.ldap_configs[0].has_password);
        assert!(parsed.ldap_configs[0].allow_invalid_tls);
    }

    #[test]
    fn config_share_rejects_foreign_and_future_files() {
        let foreign = r#"{"format":"other/app","version":1,"config":{}}"#;
        assert!(ConfigShareFile::parse(foreign).is_err());
        let future = r#"{"format":"kmaruda-phonebook/config","version":99,"config":{}}"#;
        assert!(ConfigShareFile::parse(future).is_err());
        let broken = "{ not json";
        assert!(ConfigShareFile::parse(broken).is_err());
    }
}
