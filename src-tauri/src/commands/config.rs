//! Configuration, settings exchange, and connection diagnostics commands.

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tracing::warn;

use crate::error::AppError;
use crate::services::config::{
    AppConfig, ConfigShareFile, ConfigStore, LdapOrgInput, OrgGroupsShareFile, SaveConfigRequest,
    CONFIG_SHARE_FILE_NAME, SHARE_FILE_NAME,
};
use crate::services::ldap::{self, ConnectionTest, DirectoryCredentials};
use crate::services::{external, external::ExternalRefresh};
use crate::state::AppState;

use super::run_blocking;

/// Configuration loading. Passwords are not returned - only the `hasPassword` flag.
///
/// Disk I/O is moved to the blocking task pool: Tauri v2 synchronous commands
/// run on the window's main thread and would suspend the UI for the duration of the read.
#[tauri::command]
pub async fn load_config(state: State<'_, AppState>) -> Result<AppConfig, AppError> {
    let config_dir = state.config_dir.clone();
    run_blocking(move || ConfigStore::load(&config_dir)).await
}

/// Saving configuration (without secrets). Returns the resulting configuration,
/// so the frontend synchronizes the normalized values (trim, flags).
#[tauri::command]
pub async fn save_config(
    state: State<'_, AppState>,
    config: SaveConfigRequest,
) -> Result<AppConfig, AppError> {
    let config_dir = state.config_dir.clone();
    run_blocking(move || ConfigStore::save(&config_dir, config)).await
}

/// Bind account secret management: `Some(password)` - save,
/// `None` - delete. A separate command so passwords never travel
/// together with the configuration and did not settle in the frontend store.
///
/// Accessing the system keyring can take seconds (especially the first time) -
/// therefore also off the main thread.
#[tauri::command]
pub async fn set_ldap_password(
    organization: String,
    password: Option<String>,
) -> Result<(), AppError> {
    run_blocking(move || ConfigStore::set_password(&organization, password)).await
}

/// Export organization groups to an exchange file: "Documents/KMARUDA Phonebook/
/// kmaruda-org-groups.json". Returns the full path of the written file;
/// the UI shows it with a copy button so the file can be
/// shared. Groups and the enterprise tab mark are taken from the saved
/// configuration (single source of truth, not from store drafts).
#[tauri::command]
pub async fn export_org_groups_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let config_dir = state.config_dir.clone();
    run_blocking(move || {
        let config = ConfigStore::load(&config_dir)?;
        let file = OrgGroupsShareFile::new(
            config.org_groups.clone(),
            config.enterprise_group_id.clone(),
        );
        let dir = share_dir(&app)?;
        let path = dir.join(SHARE_FILE_NAME);
        std::fs::write(&path, file.render()?)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// Parsing the contents of the group exchange file (file selection is native
/// webview `<input type="file">`; reading happens on the frontend). Format validation
/// lives in Rust ([`OrgGroupsShareFile::parse`]): the frontend does not apply
/// unvalidated data. The frontend merges it with local groups
/// (a pure function with unit tests); persistence - through the normal save_config.
#[tauri::command]
pub async fn parse_org_groups_file(content: String) -> Result<OrgGroupsShareFile, AppError> {
    run_blocking(move || OrgGroupsShareFile::parse(&content)).await
}

/// Loading an external phone file (Yealink IPPhoneBook) into the cache by
/// the current saved configuration: the path and flag are taken from disk, therefore
/// the frontend resets the save debounce before the call.
#[tauri::command]
pub async fn refresh_external_phonebook(
    state: State<'_, AppState>,
) -> Result<ExternalRefresh, AppError> {
    let db = state.db.clone();
    let config_dir = state.config_dir.clone();
    run_blocking(move || {
        let config = ConfigStore::load(&config_dir)?;
        external::refresh(
            &db,
            config.external_phonebook_enabled,
            &config.external_phonebook_paths,
            config.external_hide_ad_duplicates,
        )
    })
    .await
}

/// Native dialog for selecting phone book XML files. Returns an empty
/// list if the user closed the dialog: cancellation is not an error.
#[tauri::command]
pub async fn pick_external_phonebook_files(app: AppHandle) -> Result<Vec<String>, AppError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Select phone book files")
        .add_filter("XML (*.xml)", &["xml"])
        .pick_files(move |picked| {
            // `into_path` returns a Result: a dialog selection could theoretically
            // be a URL, not a local path. This is impossible for the file dialog,
            // but the path must not be silently lost - log it and skip the record.
            let paths = picked
                .unwrap_or_default()
                .into_iter()
                .filter_map(|value| match value.into_path() {
                    Ok(path) => Some(path.to_string_lossy().into_owned()),
                    Err(error) => {
                        warn!(error = %error, "выбранный файл не является локальным путём");
                        None
                    }
                })
                .collect();
            let _ = sender.send(paths);
        });
    Ok(receiver.await.unwrap_or_default())
}

/// Export the whole configuration to an exchange file: "Documents/KMARUDA Phonebook/
/// kmaruda-config.json". LDAP secrets never leave the machine: the `hasPassword` flag
/// reset; passwords remain in the system store.
#[tauri::command]
pub async fn export_config_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let config_dir = state.config_dir.clone();
    run_blocking(move || {
        let mut config = ConfigStore::load(&config_dir)?;
        for org in &mut config.ldap_configs {
            org.has_password = false;
        }
        let file = ConfigShareFile::new(config);
        let dir = share_dir(&app)?;
        let path = dir.join(CONFIG_SHARE_FILE_NAME);
        std::fs::write(&path, file.render()?)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// Parsing the contents of the configuration exchange file (file selection is native
/// webview `<input type="file">`; reading happens on the frontend). Format validation
/// lives in Rust ([`ConfigShareFile::parse`]): the frontend does not apply
/// unvalidated data. The frontend applies it to the store; persistence -
/// through the normal save_config.
#[tauri::command]
pub async fn parse_config_file(content: String) -> Result<AppConfig, AppError> {
    run_blocking(move || ConfigShareFile::parse(&content)).await
}

/// Exchange files folder: "Documents/KMARUDA Phonebook".
fn share_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| AppError::Config(format!("не удалось определить папку «Документы»: {e}")))?;
    let dir = dir.join("KMAruda PhoneBook");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
/// Connection diagnostics: bind, rootDSE, sample employee selection.
///
/// `passwordOverride` allows checking a password that is not saved yet;
/// if it is not set, the organization's saved secret is used.
#[tauri::command]
pub async fn test_ldap_connection(
    org: LdapOrgInput,
    password_override: Option<String>,
    connect_timeout_secs: Option<u32>,
    operation_timeout_secs: Option<u32>,
) -> Result<ConnectionTest, AppError> {
    // keyring on first access may think for seconds — we do not block
    // the async-runtime and the main window thread.
    let organization = org.organization.clone();
    let stored_password =
        run_blocking(move || Ok(ConfigStore::get_password(&organization))).await?;
    let password = password_override
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .or(stored_password);

    let credentials = DirectoryCredentials {
        ldap_url: org.ldap_url.as_str(),
        base_dn: org.base_dn.as_str(),
        bind_dn: org.bind_dn.as_deref(),
        password: password.as_deref(),
        use_start_tls: org.use_start_tls,
        allow_invalid_tls: org.allow_invalid_tls,
        use_integrated_auth: org.use_integrated_auth,
        connect_timeout_secs: u64::from(connect_timeout_secs.unwrap_or(15).clamp(1, 300)),
        operation_timeout_secs: u64::from(operation_timeout_secs.unwrap_or(30).clamp(1, 300)),
    };
    ldap::test_connection(credentials).await
}
