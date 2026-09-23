//! Хранилище конфигурации: атомарная запись `config.json` и секреты keyring.
//!
//! * `config.json` пишется атомарно (temp-файл + rename) — повреждение
//!   невозможно даже при обрыве питания.
//! * Пароли bind-учёток LDAP **никогда** не попадают ни в `config.json`,
//!   ни во фронтенд.
//! * При удалении организации её секрет гарантированно удаляется из keyring.

use std::fs;
use std::path::{Path, PathBuf};

use tracing::{info, warn};

use crate::error::AppError;

use super::model::{AppConfig, SaveConfigRequest};
use super::validate::{
    normalize_language, normalize_theme, resolve_enterprise_group_id, validate_org_groups,
    validate_orgs,
};

const CONFIG_FILE: &str = "config.json";
/// Сервис keyring общий для всех секретов приложения: пароли LDAP
/// (`ldap:<org>`) и ключ шифрования кэша (`db-key`, см. `db::encryption`).
pub(crate) const KEYRING_SERVICE: &str = "kmaruda-phonebook";

pub struct ConfigStore;

impl ConfigStore {
    /// Путь к `config.json` внутри папки данных приложения.
    pub fn config_path(dir: &Path) -> PathBuf {
        dir.join(CONFIG_FILE)
    }

    /// Загрузка конфигурации. Отсутствующий файл → значения по умолчанию,
    /// повреждённый → бэкап `.corrupt` и значения по умолчанию (без wipe БД:
    /// кэш контактов переживает проблему с конфигом).
    pub fn load(dir: &Path) -> Result<AppConfig, AppError> {
        let path = Self::config_path(dir);
        let mut config = Self::load_from_disk(&path);
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

    /// Валидация и атомарное сохранение конфигурации.
    /// Возвращает сохранённую конфигурацию (с актуальными `hasPassword`).
    pub fn save(dir: &Path, request: SaveConfigRequest) -> Result<AppConfig, AppError> {
        let path = Self::config_path(dir);
        let previous = Self::load_from_disk(&path);

        let ldap_configs = validate_orgs(request.ldap_configs)?;
        let org_groups = validate_org_groups(request.org_groups)?;
        let enterprise_group_id =
            resolve_enterprise_group_id(&org_groups, request.enterprise_group_id);

        // Секреты удалённых организаций не должны оставаться в keyring.
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

        let config = AppConfig {
            theme: normalize_theme(&request.theme),
            language: normalize_language(&request.language),
            global_mode: request.global_mode,
            saved_contact_ids: request.saved_contact_ids,
            ldap_configs,
            test_mode: request.test_mode,
            animations_enabled: request.animations_enabled,
            sync_interval_hours: request.sync_interval_hours.clamp(1, 168),
            hide_empty_contacts: request.hide_empty_contacts,
            email_overrides: request.email_overrides,
            org_groups,
            enterprise_group_id,
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        };

        Self::write_atomic(&path, &config)?;
        Ok(config)
    }

    fn write_atomic(path: &Path, config: &AppConfig) -> Result<(), AppError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(config)
            .map_err(|e| AppError::Internal(format!("сериализация конфигурации: {e}")))?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, path)?;
        info!("конфигурация сохранена");
        Ok(())
    }

    /// keyring-запись секрета LDAP организации (`ldap:<org>`).
    fn entry(organization: &str) -> Option<keyring::Entry> {
        keyring::Entry::new(KEYRING_SERVICE, &format!("ldap:{organization}")).ok()
    }

    /// `Some(password)` — установить/обновить; `None` — удалить секрет.
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

    /// Удаляет секрет; возвращает `Some(())`, если запись существовала.
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
