//! Модель конфигурации: организации, UI-предпочтения, запрос сохранения.
//!
//! Пароли в модели не живут: вместо них флаг `hasPassword` — секрет
//! остаётся в системном хранилище (см. [`super::store::ConfigStore`]).

use serde::{Deserialize, Serialize};

pub(super) fn default_theme() -> String {
    "system".to_string()
}

pub(super) fn default_language() -> String {
    "ru".to_string()
}

fn default_sync_interval() -> u32 {
    24
}

const fn default_true() -> bool {
    true
}

/// Параметры подключения к каталогу одной организации.
///
/// Эта структура одновременно описывает и то, что видит фронтенд:
/// вместо пароля в ней флаг `hasPassword` — секрет остаётся в keyring.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapOrgConfig {
    pub organization: String,
    pub ldap_url: String,
    pub base_dn: String,
    #[serde(default)]
    pub bind_dn: Option<String>,
    /// StartTLS поверх `ldap://` (AD: порт 389 + STARTTLS).
    #[serde(default)]
    pub use_start_tls: bool,
    /// Не проверять сертификат сервера (только для ldaps/StartTLS
    /// с самоподписанными сертификатами во внутреннем контуре).
    #[serde(default)]
    pub allow_invalid_tls: bool,
    /// Аутентификация под текущей сессией Windows (Kerberos/NTLM, SASL GSSAPI).
    /// Пароль не нужен.
    #[serde(default = "default_true")]
    pub use_integrated_auth: bool,
    /// Вычисляется при загрузке: есть ли пароль в системном хранилище.
    #[serde(default)]
    pub has_password: bool,
}

/// Входные данные организации при сохранении конфигурации (без пароля).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapOrgInput {
    pub organization: String,
    pub ldap_url: String,
    pub base_dn: String,
    #[serde(default)]
    pub bind_dn: Option<String>,
    #[serde(default)]
    pub use_start_tls: bool,
    #[serde(default)]
    pub allow_invalid_tls: bool,
    #[serde(default = "default_true")]
    pub use_integrated_auth: bool,
}

/// Группа организаций: несколько фильтров по AD `company`, объединённых
/// под одним названием.
///
/// Группа используется в двух местах:
/// * фильтр по организации глобальной версии — группа заменяет в дропдауне
///   поглощённые ею организации (один пункт вместо многих);
/// * вкладка «КМАруда» не глобальной версии — отмеченная в настройках группа
///   задаёт набор организаций, чьи учётки учитываются в списке.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgGroup {
    /// Стабильный идентификатор (генерирует фронтенд, UUID).
    pub id: String,
    /// Отображаемое имя объединённого фильтра.
    pub name: String,
    /// Названия организаций (значения AD `company` / имена фильтров).
    pub orgs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
    /// «Глобальная версия»: показывать все организации холдинга и фильтр по ним.
    #[serde(default)]
    pub global_mode: bool,
    #[serde(default)]
    pub saved_contact_ids: Vec<String>,
    #[serde(default)]
    pub ldap_configs: Vec<LdapOrgConfig>,
    /// Демо-режим: данные берутся из локальных моков, AD не опрашивается.
    #[serde(default)]
    pub test_mode: bool,
    #[serde(default = "default_true")]
    pub animations_enabled: bool,
    /// Период автоматической фоновой синхронизации, часов.
    #[serde(default = "default_sync_interval")]
    pub sync_interval_hours: u32,
    /// Скрывать «пустые» учётки (без почты, мобильного и рабочего телефона):
    /// системные/служебные записи не засоряют выдачу.
    #[serde(default = "default_true")]
    pub hide_empty_contacts: bool,
    /// Локальные подстановки почты для контактов без атрибута mail.
    #[serde(default)]
    pub email_overrides: std::collections::HashMap<String, String>,
    /// Именованные группы организаций (объединённые фильтры).
    #[serde(default)]
    pub org_groups: Vec<OrgGroup>,
    /// Группа для вкладки «КМАруда» (не глобальная версия): `None` —
    /// наследуемое поведение (организация первого AD-подключения).
    #[serde(default)]
    pub enterprise_group_id: Option<String>,
    /// Версия приложения, записавшая конфиг (диагностика).
    #[serde(default)]
    pub version: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            language: default_language(),
            global_mode: false,
            saved_contact_ids: Vec::new(),
            ldap_configs: Vec::new(),
            test_mode: false,
            animations_enabled: true,
            sync_interval_hours: default_sync_interval(),
            hide_empty_contacts: true,
            email_overrides: std::collections::HashMap::new(),
            org_groups: Vec::new(),
            enterprise_group_id: None,
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        }
    }
}

/// Запрос сохранения конфигурации от фронтенда.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConfigRequest {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub global_mode: bool,
    #[serde(default)]
    pub saved_contact_ids: Vec<String>,
    #[serde(default)]
    pub ldap_configs: Vec<LdapOrgInput>,
    #[serde(default)]
    pub test_mode: bool,
    #[serde(default = "default_true")]
    pub animations_enabled: bool,
    #[serde(default = "default_sync_interval")]
    pub sync_interval_hours: u32,
    #[serde(default = "default_true")]
    pub hide_empty_contacts: bool,
    #[serde(default)]
    pub email_overrides: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub org_groups: Vec<OrgGroup>,
    #[serde(default)]
    pub enterprise_group_id: Option<String>,
}
