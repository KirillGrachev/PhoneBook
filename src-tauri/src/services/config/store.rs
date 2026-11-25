//! Configuration store: atomic `config.json` writes and keyring secrets.
//!
//! * `config.json` is written atomically (temp file + rename) - corruption
//!   impossible even on power loss.
//! * LDAP bind account passwords **never** end up in `config.json`,
//!   nor into the frontend.
//! * When an organization is deleted, its secret is guaranteed to be removed from the keyring.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tracing::{info, warn};

use crate::error::AppError;

use super::model::{AppConfig, SaveConfigRequest};
use super::validate::{
    normalize_language, normalize_theme, resolve_enterprise_group_id, validate_org_groups,
    validate_orgs,
};

const CONFIG_FILE: &str = "config.json";
/// The keyring service is shared by all application secrets: LDAP passwords
/// (`ldap:<org>`) and the cache encryption key (`db-key`, see `db::encryption`).
pub(crate) const KEYRING_SERVICE: &str = "kmaruda-phonebook";

pub struct ConfigStore;

impl ConfigStore {
    /// Path to `config.json` inside the application data folder.
    pub fn config_path(dir: &Path) -> PathBuf {
        dir.join(CONFIG_FILE)
    }

    /// Configuration loading. Missing file -> default values,
    /// corrupted -> `.corrupt` backup and default values (without wiping the DB:
    /// the contact cache survives the config problem).
    pub fn load(dir: &Path) -> Result<AppConfig, AppError> {
        let path = Self::config_path(dir);
        let mut config = Self::load_from_disk(&path);
        // Migrate the legacy single path into the list on first load.
        if config.external_phonebook_paths.is_empty() {
            if let Some(path) = config.external_phonebook_path.take() {
                config.external_phonebook_paths = normalize_external_paths(vec![path], None);
            }
        }
        config.external_phonebook_path = config.external_phonebook_paths.first().cloned();
        // Managed fields are computed on every load; never trust a stale
        // `managed` flag written to disk.
        config.managed = false;
        config.managed_profile = None;
        config.managed_revision = None;
        if let Some(profile) = super::embedded::profile() {
            apply_managed(&mut config, profile);
        }
        Self::attach_password_flags(&mut config);
        Ok(config)
    }

    pub(super) fn load_from_disk(path: &Path) -> AppConfig {
        let Ok(content) = fs::read_to_string(path) else {
            return AppConfig::default();
        };
        match serde_json::from_str::<AppConfig>(&content) {
            Ok(config) => config,
            Err(e) => {
                warn!(error = %e, "config.json повреждён, делаю резервную копию и использую значения по умолчанию");
                let backup = path.with_extension("json.corrupt");
                let _ = fs::rename(path, &backup);
                AppConfig::default()
            }
        }
    }

    fn attach_password_flags(config: &mut AppConfig) {
        for org in &mut config.ldap_configs {
            org.has_password = Self::get_password(&org.organization).is_some();
        }
    }

    /// Configuration validation and atomic save.
    /// Returns the saved configuration (with up-to-date `hasPassword`).
    pub fn save(dir: &Path, request: SaveConfigRequest) -> Result<AppConfig, AppError> {
        let path = Self::config_path(dir);
        let previous = Self::load_from_disk(&path);

        let ldap_configs = validate_orgs(request.ldap_configs)?;
        let org_groups = validate_org_groups(request.org_groups)?;
        let enterprise_group_id =
            resolve_enterprise_group_id(&org_groups, request.enterprise_group_id);
        let external_phonebook_paths = normalize_external_paths(
            request.external_phonebook_paths,
            request.external_phonebook_path,
        );
        let external_phonebook_intervals = normalize_external_intervals(
            request.external_phonebook_intervals,
            &external_phonebook_paths,
        );

        // Secrets of deleted organizations must not remain in the keyring.
        let kept: Vec<&str> = ldap_configs
            .iter()
            .map(|o| o.organization.as_str())
            .collect();
        for old in &previous.ldap_configs {
            if !kept.contains(&old.organization.as_str())
                && Self::delete_password(&old.organization).is_some()
            {
                info!(organization = %old.organization, "удалён секрет удалённой организации");
            }
        }

        let mut config = AppConfig {
            theme: normalize_theme(&request.theme),
            language: normalize_language(&request.language),
            global_mode: request.global_mode,
            saved_contact_ids: request.saved_contact_ids,
            ldap_configs,
            test_mode: request.test_mode,
            animations_enabled: request.animations_enabled,
            show_avatars: request.show_avatars,
            sync_interval_hours: request.sync_interval_hours.clamp(1, 168),
            ldap_connect_timeout_secs: request.ldap_connect_timeout_secs.clamp(1, 300),
            ldap_operation_timeout_secs: request.ldap_operation_timeout_secs.clamp(1, 300),
            hide_empty_contacts: request.hide_empty_contacts,
            email_overrides: request.email_overrides,
            org_groups,
            enterprise_group_id,
            external_phonebook_path: external_phonebook_paths.first().cloned(),
            external_phonebook_paths,
            external_phonebook_enabled: request.external_phonebook_enabled,
            external_phonebook_intervals,
            external_hide_ad_duplicates: request.external_hide_ad_duplicates,
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            managed: false,
            managed_profile: None,
            managed_revision: None,
        };

        // The UI is disabled for managed sections, but a direct IPC call could
        // still send overridden values. Rust remains the source of truth.
        if let Some(profile) = super::embedded::profile() {
            apply_managed(&mut config, profile);
        }

        Self::write_atomic(&path, &config)?;
        Ok(config)
    }

    fn write_atomic(path: &Path, config: &AppConfig) -> Result<(), AppError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        // `managed` and profile metadata are runtime-only; keep config.json a
        // normal local file even when the embedded profile is active.
        let mut disk = config.clone();
        disk.managed = false;
        disk.managed_profile = None;
        disk.managed_revision = None;
        let json = serde_json::to_string_pretty(&disk)
            .map_err(|e| AppError::Internal(format!("сериализация конфигурации: {e}")))?;
        let tmp = path.with_extension("json.tmp");
        let mut file = fs::File::create(&tmp)?;
        file.write_all(json.as_bytes())?;
        // Sync the contents before rename: otherwise a power failure
        // could yield an empty/partial config.json.
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)?;
        info!("конфигурация сохранена");
        Ok(())
    }

    /// keyring entry for an organization's LDAP secret (`ldap:<org>`).
    fn entry(organization: &str) -> Option<keyring::Entry> {
        keyring::Entry::new(KEYRING_SERVICE, &format!("ldap:{organization}")).ok()
    }

    /// `Some(password)` - set/update; `None` - delete the secret.
    pub fn set_password(organization: &str, password: Option<String>) -> Result<(), AppError> {
        let organization = organization.trim();
        if organization.is_empty() {
            return Err(AppError::Validation(
                "Секрет можно сохранить только для организации с непустым названием".into(),
            ));
        }
        let Some(entry) = Self::entry(organization) else {
            return Err(AppError::Config(
                "Системное хранилище секретов недоступно на этой платформе".into(),
            ));
        };
        match password {
            Some(pw) if !pw.is_empty() => entry.set_password(&pw).map_err(|e| {
                AppError::Config(format!(
                    "не удалось сохранить пароль в системном хранилище: {e}"
                ))
            }),
            _ => {
                Self::delete_password(organization);
                Ok(())
            }
        }
    }

    pub fn get_password(organization: &str) -> Option<String> {
        Self::entry(organization)?.get_password().ok()
    }

    /// Deletes the secret; returns `Some(())` if the entry existed.
    fn delete_password(organization: &str) -> Option<()> {
        let entry = Self::entry(organization)?;
        match entry.delete_credential() {
            Ok(()) => Some(()),
            Err(keyring::Error::NoEntry) => None,
            Err(e) => {
                warn!(organization, error = %e, "не удалось удалить секрет из keyring");
                None
            }
        }
    }
}

/// Administrative fields come from the embedded profile; theme/language/
/// favorites/email overrides remain local to the machine.
fn apply_managed(local: &mut AppConfig, profile: super::embedded::EmbeddedProfile) {
    let managed = profile.config;
    local.ldap_configs = managed.ldap_configs;
    local.org_groups = managed.org_groups;
    local.enterprise_group_id = managed.enterprise_group_id;
    local.global_mode = managed.global_mode;
    local.test_mode = managed.test_mode;
    local.sync_interval_hours = managed.sync_interval_hours;
    local.ldap_connect_timeout_secs = managed.ldap_connect_timeout_secs;
    local.ldap_operation_timeout_secs = managed.ldap_operation_timeout_secs;
    local.hide_empty_contacts = managed.hide_empty_contacts;
    local.external_phonebook_path = managed.external_phonebook_path;
    local.external_phonebook_paths = managed.external_phonebook_paths;
    local.external_phonebook_enabled = managed.external_phonebook_enabled;
    local.external_phonebook_intervals = managed.external_phonebook_intervals;
    local.external_hide_ad_duplicates = managed.external_hide_ad_duplicates;
    local.managed = true;
    local.managed_profile = profile.name;
    local.managed_revision = profile.revision;
}

/// Trims, drops empty entries and de-duplicates external phone book paths.
/// Windows paths are case-insensitive, so de-duplication folds case.
fn normalize_external_paths(paths: Vec<String>, legacy: Option<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let candidates = if paths.is_empty() {
        legacy.into_iter().collect::<Vec<_>>()
    } else {
        paths
    };
    candidates
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .filter(|path| seen.insert(path.to_lowercase()))
        .collect()
}

/// Keep schedules only for selected files; `0` means manual refresh.
fn normalize_external_intervals(
    intervals: HashMap<String, u32>,
    paths: &[String],
) -> HashMap<String, u32> {
    paths
        .iter()
        .filter_map(|path| {
            intervals
                .get(path)
                .copied()
                .filter(|hours| *hours > 0)
                .map(|hours| (path.clone(), hours.clamp(1, 168)))
        })
        .collect()
}
