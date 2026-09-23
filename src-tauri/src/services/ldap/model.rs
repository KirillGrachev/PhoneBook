//! Типы LDAP-слоя: учётные данные, сырая запись каталога, результат теста.

use std::time::Duration;

use serde::Serialize;

pub(super) const PAGE_SIZE: i32 = 500;
/// Таймаут установки соединения (и StartTLS-рукопожатия).
pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Таймаут отдельной LDAP-операции (bind, поиск страницы, rootDSE).
pub(super) const OPERATION_TIMEOUT: Duration = Duration::from_secs(30);

/// Фильтр «живых» пользователей AD: person + user, без заблокированных
/// (флаг ACCOUNTDISABLE в userAccountControl).
pub const USER_FILTER: &str =
    "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))";

pub(super) const USER_ATTRIBUTES: &[&str] = &[
    "samAccountName",
    "displayName",
    "givenName",
    "sn",
    "initials",
    "title",
    "department",
    "company",
    "physicalDeliveryOfficeName",
    "mail",
    "telephoneNumber",
    "mobile",
    "ipPhone",
    "manager",
    "pager",
    "userAccountControl",
    "objectGUID",
    "uSNChanged",
];

/// Параметры подключения к каталогу организации.
#[derive(Debug, Clone)]
pub struct DirectoryCredentials<'a> {
    pub ldap_url: &'a str,
    pub base_dn: &'a str,
    pub bind_dn: Option<&'a str>,
    pub password: Option<&'a str>,
    pub use_start_tls: bool,
    pub allow_invalid_tls: bool,
    pub use_integrated_auth: bool,
}

/// Сырые данные пользователя из LDAP (до нормализации в [`crate::services::db::UserRecord`]).
#[derive(Debug, Clone)]
pub struct RawUser {
    pub dn: String,
    pub object_guid: String,
    pub sam_account_name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub middle_name: Option<String>,
    pub display_name: Option<String>,
    pub title: Option<String>,
    pub department: Option<String>,
    pub company: Option<String>,
    pub office: Option<String>,
    pub email: Option<String>,
    pub ip_phone: Option<String>,
    pub phone_external: Option<String>,
    pub phone_mobile: Option<String>,
    pub manager_dn: Option<String>,
    /// TrueConf ID сотрудника хранится в AD-атрибуте `pager`.
    pub pager: Option<String>,
    /// Флаги учётки (`userAccountControl`): бит ACCOUNTDISABLE означает
    /// отключённую учётку (уволенный сотрудник или архив) — такие записи
    /// не попадают в справочник даже при ошибке фильтра поиска.
    pub user_account_control: Option<i64>,
    pub usn_changed: Option<i64>,
}

/// Бит ACCOUNTDISABLE в `userAccountControl`.
pub const UAC_ACCOUNTDISABLE: i64 = 0x2;

impl RawUser {
    /// Учётка отключена: человек не пользуется ей или уволен.
    pub fn is_account_disabled(&self) -> bool {
        self.user_account_control
            .is_some_and(|flags| flags & UAC_ACCOUNTDISABLE != 0)
    }
}

/// Результат диагностической команды «Проверить подключение».
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    /// Время bind, мс.
    pub bind_ms: u64,
    /// `dnsHostName` из rootDSE.
    pub server_dns_name: Option<String>,
    /// `defaultNamingContext` из rootDSE — подсказка для Base DN.
    pub default_naming_context: Option<String>,
    /// Первые найденные сотрудники (до 5 имён) — доказательство, что поиск работает.
    pub sample_names: Vec<String>,
    /// `true`, если сотрудников больше, чем показано в `sample_names`.
    pub sample_is_truncated: bool,
}
