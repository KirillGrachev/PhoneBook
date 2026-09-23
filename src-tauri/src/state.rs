//! Общее управляемое состояние приложения.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::services::db::Db;
use crate::services::sync::SyncManager;

/// Состояние, доступное всем командам через `State<'_, AppState>`.
///
/// Дешёвая в клонировании ручка (`Arc` внутри `Db` и `SyncManager`),
/// поэтому фоновые задачи могут владеть ею без заимствования `AppHandle`.
#[derive(Clone)]
pub struct AppState {
    /// Папка данных приложения: `config.json` и `phonebook.db`.
    pub config_dir: PathBuf,
    pub db: Db,
    pub sync: SyncManager,
}

impl AppState {
    pub fn init(app: &AppHandle) -> Result<Self, AppError> {
        let config_dir = app.path().app_data_dir().map_err(|e| {
            AppError::Config(format!(
                "не удалось определить папку данных приложения: {e}"
            ))
        })?;
        let db = Db::open(&config_dir.join("phonebook.db"))?;
        Ok(Self {
            config_dir,
            db,
            sync: SyncManager::new(),
        })
    }
}
