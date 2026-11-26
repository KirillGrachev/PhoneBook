//! Embedded configuration profile (only builds with `--features embedded-config`).
//!
//! Payload is a regular `kmaruda-phonebook/config` export file obtained via the
//! "Export configuration" button on the reference machine. Secrets are not
//! included: `ConfigShareFile::parse` resets `hasPassword`.

#[cfg(feature = "embedded-config")]
use serde::Deserialize;

use super::AppConfig;
#[cfg(feature = "embedded-config")]
use super::ConfigShareFile;

#[cfg(feature = "embedded-config")]
const EMBEDDED_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/embedded-config.json"));

/// Profile metadata not included in `AppConfig`.
#[cfg(feature = "embedded-config")]
#[derive(Debug, Default, Deserialize)]
struct ProfileMeta {
    #[serde(default)]
    profile: Option<String>,
    #[serde(default)]
    revision: Option<u32>,
}

/// Parsed embedded profile.
#[derive(Debug, Clone)]
pub struct EmbeddedProfile {
    pub config: AppConfig,
    pub name: Option<String>,
    pub revision: Option<u32>,
}

/// `None` - a normal build; `Some` - a managed rollout.
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
