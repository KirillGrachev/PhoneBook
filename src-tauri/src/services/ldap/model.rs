//! LDAP layer types: credentials, raw catalog record, test result.

use std::time::Duration;

use serde::Serialize;

pub(super) const PAGE_SIZE: i32 = 500;

/// Filter for "live" AD users: person + user, without blocked
/// (the ACCOUNTDISABLE flag in userAccountControl).
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
    "thumbnailPhoto",
];

/// Organization catalog connection parameters.
#[derive(Debug, Clone)]
pub struct DirectoryCredentials<'a> {
    pub ldap_url: &'a str,
    pub base_dn: &'a str,
    pub bind_dn: Option<&'a str>,
    pub password: Option<&'a str>,
    pub use_start_tls: bool,
    pub allow_invalid_tls: bool,
    pub use_integrated_auth: bool,
    /// Per-connection TCP/TLS handshake timeout.
    pub connect_timeout_secs: u64,
    /// Timeout for one LDAP operation/page.
    pub operation_timeout_secs: u64,
}

impl DirectoryCredentials<'_> {
    pub(super) fn connect_timeout(&self) -> Duration {
        Duration::from_secs(self.connect_timeout_secs.clamp(1, 300))
    }

    pub(super) fn operation_timeout(&self) -> Duration {
        Duration::from_secs(self.operation_timeout_secs.clamp(1, 300))
    }
}

/// Raw user data from LDAP (before normalization into [`crate::services::db::UserRecord`]).
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
    /// The employee's TrueConf ID is stored in the AD `pager` attribute.
    pub pager: Option<String>,
    /// Account flags (`userAccountControl`): the ACCOUNTDISABLE bit means
    /// a disabled account (dismissed employee or archive) - such records
    /// do not enter the lookup even if the search filter fails.
    pub user_account_control: Option<i64>,
    pub usn_changed: Option<i64>,
    /// Raw bytes of the AD `thumbnailPhoto` attribute (usually JPEG).
    /// `None` when the account has no photo; the UI then shows a letter avatar.
    pub photo: Option<Vec<u8>>,
}

/// The ACCOUNTDISABLE bit in `userAccountControl`.
pub const UAC_ACCOUNTDISABLE: i64 = 0x2;

impl RawUser {
    /// The account is disabled: the person does not use it or has been dismissed.
    pub fn is_account_disabled(&self) -> bool {
        self.user_account_control
            .is_some_and(|flags| flags & UAC_ACCOUNTDISABLE != 0)
    }
}

/// Result of the "Check connection" diagnostic command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    /// Bind time, ms.
    pub bind_ms: u64,
    /// `dnsHostName` from rootDSE.
    pub server_dns_name: Option<String>,
    /// `defaultNamingContext` from rootDSE - a hint for the Base DN.
    pub default_naming_context: Option<String>,
    /// The first employees found (up to 5 names) - proof that search works.
    pub sample_names: Vec<String>,
    /// `true` if there are more employees than shown in `sample_names`.
    pub sample_is_truncated: bool,
}
