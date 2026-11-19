//! Встроенный профиль конфигурации (только сборка с `--features embedded-config`).
//!
//! Payload — обычный файл экспорта `kmaruda-phonebook/config`, полученный
//! кнопкой «Экспорт конфигурации» на эталонной машине. Секреты в него не
//! попадают: `ConfigShareFile::parse` сбрасывает `hasPassword`.

#[cfg(feature = "embedded-config")]
use serde::Deserialize;

use super::AppConfig;
#[cfg(feature = "embedded-config")]
use super::ConfigShareFile;

#[cfg(feature = "embedded-config")]
const EMBEDDED_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/embedded-config.json"));

/// Метаданные профиля, не входящие в `AppConfig`.
#[cfg(feature = "embedded-config")]
#[derive(Debug, Default, Deserialize)]
struct ProfileMeta {
    #[serde(default)]
    profile: Option<String>,
    #[serde(default)]
    revision: Option<u32>,
}

/// Разобранный встроенный профиль.
#[derive(Debug, Clone)]
pub struct EmbeddedProfile {
    pub config: AppConfig,
    pub name: Option<String>,
    pub revision: Option<u32>,
}

/// `None` — обычная сборка; `Some` — управляемая раскатка.
pub fn profile() -> Option<EmbeddedProfile> {
    #[cfg(feature = "embedded-config")]
    {
        let config = ConfigShareFile::parse(EMBEDDED_JSON)
            .expect("embedded config profile must be a valid KMAruda config export");
        let meta: ProfileMeta =
            serde_json::from_str(EMBEDDED_JSON).expect("embedded config metadata must be valid");
        Some(EmbeddedProfile {
            config,
            name: meta.profile,
            revision: meta.revision,
        })
    }
    #[cfg(not(feature = "embedded-config"))]
    {
        None
    }
}

#[cfg(all(test, feature = "embedded-config"))]
mod tests {
    #[test]
    fn embedded_profile_parses() {
        let profile = super::profile().expect("embedded profile");
        assert!(!profile.config.ldap_configs.is_empty());
    }
}
