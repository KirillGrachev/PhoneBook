//! Команды синхронизации с Active Directory.

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::services::config::ConfigStore;
use crate::services::sync::SyncStatus;
use crate::state::AppState;

/// Запускает фоновую синхронизацию. Возвращает `true`, если запуск принят,
/// `false` — если синхронизация уже идёт (single-flight).
#[tauri::command]
pub fn start_sync(
    app: AppHandle,
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<bool, AppError> {
    Ok(state.sync.spawn(app, force.unwrap_or(false)))
}

/// Текущий статус: идёт ли синхронизация и метаданные по организациям.
///
/// Читает `sync_meta` из кэша (мьютекс!) и конфигурацию с диска: во время
/// прогона синхронизации мьютекс занят большой транзакцией, поэтому команда
/// async и исполняется в пуле блокирующих задач — главный поток окна не
/// ждёт и UI не «зависает» на период синхронизации.
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
