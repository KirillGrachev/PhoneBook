//! Active Directory sync commands.

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::services::config::ConfigStore;
use crate::services::sync::SyncStatus;
use crate::state::AppState;

/// Starts background sync. Returns `true` if the start was accepted,
/// `false` if sync is already running (single-flight).
#[tauri::command]
pub fn start_sync(
    app: AppHandle,
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<bool, AppError> {
    Ok(state.sync.spawn(app, force.unwrap_or(false)))
}

/// Current status: whether sync is running and per-organization metadata.
///
/// Reads `sync_meta` from the cache (mutex!) and configuration from disk: during
/// a sync run the mutex is held by a large transaction, so the command is
/// async and runs in the blocking task pool; the window's main thread does not
/// wait, and the UI does not "hang" during sync.
#[tauri::command]
pub async fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatus, AppError> {
    let db = state.db.clone();
    let sync = state.sync.clone();
    let config_dir = state.config_dir.clone();
    super::run_blocking(move || {
        let configured: Vec<String> = ConfigStore::load(&config_dir)?
            .ldap_configs
            .into_iter()
            .map(|org| org.organization)
            .collect();
        Ok(sync.status(&db, &configured))
    })
    .await
}
