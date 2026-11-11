//! Общее управляемое состояние приложения.

use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::services::db::{Db, SearchPage};
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
    /// Последний запрошенный поиск: старые запросы, ещё стоящие в очереди
    /// за мьютексом БД, не должны выполняться.
    pub search_latest: Arc<AtomicU64>,
    /// Последняя завершённая страница — ответ для устаревшего запроса.
    pub search_cache: Arc<Mutex<Option<(u64, SearchPage)>>>,
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
            search_latest: Arc::new(AtomicU64::new(0)),
            search_cache: Arc::new(Mutex::new(None)),
        })
    }
}
