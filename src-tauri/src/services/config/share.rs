//! Файлы обмена настройками: перенос конфигурации между машинами.
//!
//! Группы организаций и вся конфигурация живут в локальном `config.json`
//! (SQLite-кэш — только восстанавливаемое зеркало AD). Файлы обмена — способ
//! передать эти настройки на другой ПК: экспорт пишет их в «Документы»,
//! импорт читает и проверяет формат до применения.
//!
//! Форматы самодокументируемые и версионируемые: маркер `format` защищает от
//! случайного импорта чужого JSON, `version` — от файлов будущего формата.
//! Секреты (пароли LDAP) не покидают машину ни в одном из форматов.

use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

use super::model::{AppConfig, OrgGroup};

/// Маркер формата: импорт чужого JSON отклоняется с понятной ошибкой.
pub const SHARE_FORMAT: &str = "kmaruda-phonebook/org-groups";
/// Текущая версия формата.
pub const SHARE_VERSION: u32 = 1;
/// Имя файла, предлагаемое при экспорте.
pub const SHARE_FILE_NAME: &str = "kmaruda-org-groups.json";

/// Содержимое файла обмена группами организаций.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgGroupsShareFile {
    /// Маркер формата ([`SHARE_FORMAT`]).
    pub format: String,
    /// Версия формата ([`SHARE_VERSION`]).
    pub version: u32,
    /// Момент экспорта (unix-секунды): справочное поле для получателя.
    #[serde(default)]
    pub exported_at: Option<i64>,
    /// Группы организаций (объединённые фильтры).
    pub groups: Vec<OrgGroup>,
    /// Отметка группы для вкладки «КМАруда» на машине-источнике. Может
    /// указывать на группу, которой у получателя нет после слияния — тогда
    /// отметка игнорируется, чужая вкладка не ломается.
    #[serde(default)]
    pub enterprise_group_id: Option<String>,
}

impl OrgGroupsShareFile {
    /// Собрать файл обмена из текущей конфигурации.
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

    /// Разобрать и проверить содержимое файла обмена.
    pub fn parse(content: &str) -> Result<Self, AppError> {
        let file: Self = serde_json::from_str(content).map_err(|e| {
            AppError::Validation(format!(
                "Файл групп организаций не является корректным JSON: {e}"
            ))
        })?;
        file.validate()?;
        Ok(file.normalized())
    }

    /// Проверка формата: маркер, версия, целостность групп.
    pub fn validate(&self) -> Result<(), AppError> {
        if self.format != SHARE_FORMAT {
            return Err(AppError::Validation(format!(
                "Это не файл групп организаций KMAruda Phonebook (неизвестный формат «{}»)",
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

    /// Нормализованный вид: пробелы обрезаны, пустые организации удалены,
    /// дубли организаций внутри группы схлопнуты.
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

    /// Pretty-JSON для записи в файл обмена.
    pub fn render(&self) -> String {
        serde_json::to_string_pretty(self).expect("файл обмена группами сериализуем")
    }
}

/// Маркер формата файла обмена конфигурацией.
pub const CONFIG_SHARE_FORMAT: &str = "kmaruda-phonebook/config";
/// Текущая версия формата файла обмена конфигурацией.
pub const CONFIG_SHARE_VERSION: u32 = 1;
/// Имя файла, предлагаемое при экспорте конфигурации.
pub const CONFIG_SHARE_FILE_NAME: &str = "kmaruda-config.json";

/// Файл обмена конфигурацией: полный перенос настроек на другой ПК
/// (оформление, подключения AD без секретов, группы, внешний телефонный файл).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigShareFile {
    /// Маркер формата ([`CONFIG_SHARE_FORMAT`]).
    pub format: String,
    /// Версия формата ([`CONFIG_SHARE_VERSION`]).
    pub version: u32,
    /// Момент экспорта (unix-секунды): справочное поле для получателя.
    #[serde(default)]
    pub exported_at: Option<i64>,
    /// Конфигурация машины-источника.
    pub config: AppConfig,
}

impl ConfigShareFile {
    /// Собрать файл обмена из текущей конфигурации.
    pub fn new(config: AppConfig) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);
        Self {
            format: CONFIG_SHARE_FORMAT.to_string(),
            version: CONFIG_SHARE_VERSION,
            exported_at: Some(now),
            config,
        }
    }

    /// Разобрать и проверить содержимое файла обмена: чужой JSON и файлы
    /// будущих версий отклоняются до применения настроек.
    pub fn parse(content: &str) -> Result<AppConfig, AppError> {
        let file: Self = serde_json::from_str(content).map_err(|e| {
            AppError::Config(format!(
                "Файл конфигурации не является корректным JSON: {e}"
            ))
        })?;
        if file.format != CONFIG_SHARE_FORMAT {
            return Err(AppError::Config(format!(
                "Это не файл конфигурации KMAruda Phonebook (неизвестный формат «{}»)",
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
        // Флаг «пароль сохранён» машины-источника на этой машине ложён:
        // секреты хранятся в системном хранилище и не переносятся.
        for org in &mut config.ldap_configs {
            org.has_password = false;
        }
        Ok(config)
    }

    /// Pretty-JSON для записи в файл обмена.
    pub fn render(&self) -> String {
        serde_json::to_string_pretty(self).expect("файл обмена конфигурацией сериализуем")
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
        let parsed = OrgGroupsShareFile::parse(&file.render()).expect("roundtrip");
        assert_eq!(parsed, file);
        // Нормализация: пробелы обрезаны, дубль организации схлопнут, пустая удалена.
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
    fn config_share_roundtrip_keeps_settings() {
        let config = AppConfig {
            theme: "dark".to_string(),
            external_phonebook_path: Some("C:\\PhoneBook\\yealink.xml".to_string()),
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

        let rendered = ConfigShareFile::new(config.clone()).render();
        let parsed = ConfigShareFile::parse(&rendered).expect("parse");
        assert_eq!(parsed.theme, "dark");
        assert_eq!(
            parsed.external_phonebook_path,
            config.external_phonebook_path
        );
        assert!(parsed.external_phonebook_enabled);
        // Секрет не переносится: флаг пароля сбрасывается.
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
