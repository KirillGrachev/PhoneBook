//! Cache data types: employee DTO, sync record, search parameters.

use serde::{Deserialize, Serialize};

/// Employee - a DTO crossing the IPC boundary (serde -> camelCase).
///
/// Intentionally **does not contain** the photo: `thumbnailPhoto` is stored in the cache as
/// a separate BLOB and is returned by the point command `get_contact_photo` only
/// for the open card - search pages stay compact.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Employee {
    pub object_guid: String,
    pub source_org: String,
    // Empty fields are not serialized: a directory of tens of thousands of rows gives
    // a noticeably smaller IPC payload; the frontend reads them via `?.`/`??`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sam_account_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub middle_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub department: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub company: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub office: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone_external: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone_mobile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manager: Option<String>,
    /// Supervisor GUID for clicking a card from a subordinate's card.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manager_guid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usn_changed: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    /// TrueConf ID (the AD `pager` attribute).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pager: Option<String>,
}

/// AD contact used to cut off duplicates in the external phone book.
///
/// Comparison is by full name + any non-empty contact/attribute. A separate
/// the structure is needed so `external` does not depend on the SQL schema.
#[derive(Debug, Clone)]
pub struct AdDuplicateRecord {
    pub display_name: String,
    pub title: Option<String>,
    pub department: Option<String>,
    pub company: Option<String>,
    pub office: Option<String>,
    pub email: Option<String>,
    pub ip_phone: Option<String>,
    pub phone_external: Option<String>,
    pub phone_mobile: Option<String>,
}

/// Record prepared by the sync service for insertion into the DB.
///
/// Text values (organization, department, office) are normalized
/// into lookups on the DB side - [`Db::replace_org_users`].
pub struct UserRecord {
    pub object_guid: String,
    pub sam_account_name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub middle_name: Option<String>,
    pub display_name: String,
    pub sort_key: String,
    pub title: Option<String>,
    pub department: Option<String>,
    pub company: Option<String>,
    pub office: Option<String>,
    pub email: Option<String>,
    pub ip_phone: Option<String>,
    pub phone_external: Option<String>,
    pub phone_mobile: Option<String>,
    pub manager: Option<String>,
    /// Supervisor GUID if present in the same AD selection
    /// (otherwise `None` and the card is searched by name).
    pub manager_guid: Option<String>,
    /// TrueConf ID (the AD `pager` attribute).
    pub pager: Option<String>,
    pub usn_changed: Option<i64>,
    /// Service token string for FTS (initials, email, phone "tails").
    pub tokens: String,
    /// Raw avatar bytes (AD `thumbnailPhoto`); `None` for a letter avatar.
    /// Stored as a BLOB and served lazily per card, never in search pages.
    pub photo: Option<Vec<u8>>,
}

/// Search result page: the contacts themselves + the EXACT total number of matches
/// (without LIMIT) - the sidebar shows the full count, not "300+".
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub items: Vec<Employee>,
    pub total: u64,
}

/// Parameters of the `search_contacts` command.
#[derive(Debug, Default, Clone, Hash, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub organization: Option<String>,
    /// Organization union (filter group from settings): each name is
    /// resolved to an `orgs` lookup key (exact match or
    /// the single lookup containing it), results consider the union.
    /// `Some(empty list)` after resolution - "return nothing"
    /// (no organization of the group was found in AD); `None` - no filter.
    /// A pair with `source_org` is a fallback marker to the sync source,
    /// used when the group did not resolve to any lookup.
    #[serde(default)]
    pub organizations: Option<Vec<String>>,
    /// Filter by sync source organization: unlike
    /// `organization` (the AD `company` attribute); includes accounts with an unfilled
    /// organization - e.g. service accounts. The enterprise tab passes it
    /// only as a pair with `organization` (the same name): this is a fallback marker for
    /// [`crate::services::db::read`] in case the name from settings does not
    /// match any `company` in AD.
    #[serde(default)]
    pub source_org: Option<String>,
    #[serde(default)]
    pub department: Option<String>,
    /// Job title filter (clicking the job title in the card).
    #[serde(default)]
    pub title: Option<String>,
    /// Office filter (clicking the office in the card): list of people
    /// in the same office - the same exact filter as department/job title.
    #[serde(default)]
    pub office: Option<String>,
    /// Exact selection by GUID (the "My contacts" tab).
    #[serde(default)]
    pub ids: Option<Vec<String>>,
    /// Hide accounts without email and phones (junk/system).
    /// Enabled by default: the IPC client may not send the key at all.
    #[serde(default = "default_hide_empty")]
    pub hide_empty: bool,
    #[serde(default)]
    pub limit: Option<u32>,
    /// Offset of a result portion (paginated catalog list loading).
    #[serde(default)]
    pub offset: Option<u32>,
    /// Monotonic search request number: stale requests that have not yet
    /// that reached the DB are discarded.
    #[serde(default)]
    pub request_id: Option<u64>,
}

/// IPC default value for [`SearchParams::hide_empty`].
fn default_hide_empty() -> bool {
    true
}

/// Metadata of the organization's last sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgSyncMeta {
    pub organization: String,
    pub last_sync_at: Option<i64>,
    pub last_count: Option<i64>,
    pub last_error: Option<String>,
    /// Maximum `uSNChanged` applied to this source's cache.
    #[serde(default)]
    pub last_usn: Option<i64>,
    /// Time of the last full selection: only it removes disappeared records.
    #[serde(default)]
    pub last_full_sync_at: Option<i64>,
}
