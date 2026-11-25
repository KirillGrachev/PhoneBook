//! Shared managed application state.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};
use tracing::{info, warn};

use crate::error::AppError;
use crate::services::db::{Db, SearchPage};
use crate::services::sync::SyncManager;

/// Name of the data directory used by versions before 0.2.19.
/// The Tauri identifier (`com.kmaruda.phonebook`) must no longer be
/// the visible folder name in `%APPDATA%`.
const LEGACY_DATA_DIR: &str = "com.kmaruda.phonebook";

/// State available to all commands via `State<'_, AppState>`.
///
/// Cheap-to-clone handle (`Arc` inside `Db` and `SyncManager`),
/// so background tasks can own it without borrowing `AppHandle`.
#[derive(Clone)]
pub struct AppState {
    /// Application data folder: `config.json` and `phonebook.db`.
    pub config_dir: PathBuf,
    pub db: Db,
    pub sync: SyncManager,
    /// Last requested search: old requests still queued
    /// behind the DB mutex, must not run.
    pub search_latest: Arc<AtomicU64>,
    /// The last completed page - the response for a stale request.
    pub search_cache: Arc<Mutex<Option<(u64, SearchPage)>>>,
}

impl AppState {
    pub fn init(app: &AppHandle) -> Result<Self, AppError> {
        let config_dir = app.path().app_data_dir().map_err(|e| {
            AppError::Config(format!(
                "не удалось определить папку данных приложения: {e}"
            ))
        })?;
        migrate_legacy_app_data(app, &config_dir)?;
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

/// Moves `%APPDATA%\com.kmaruda.phonebook` to the new directory
/// `%APPDATA%\KMAruda PhoneBook`, so an update does not start with an empty
/// cache and settings. First tries to atomically rename the directory; if
/// the new directory already exists, copies the missing files, and removes the old one.
fn migrate_legacy_app_data(app: &AppHandle, new_dir: &Path) -> Result<(), AppError> {
    let Some(old_dir) = legacy_data_dir(app) else {
        return Ok(());
    };
    if old_dir == new_dir || !old_dir.is_dir() {
        return Ok(());
    }

    match migrate_legacy_dir(&old_dir, new_dir) {
        Ok(true) => {
            info!(
                old = %old_dir.display(),
                new = %new_dir.display(),
                "каталог данных приложения перенесён"
            );
            cleanup_legacy_local_data(app);
        }
        Ok(false) => {}
        Err(error) => {
            warn!(
                old = %old_dir.display(),
                new = %new_dir.display(),
                %error,
                "не удалось перенести каталог данных"
            );
            return Err(AppError::Config(format!(
                "не удалось перенести данные из {} в {}: {error}",
                old_dir.display(),
                new_dir.display()
            )));
        }
    }
    Ok(())
}

fn legacy_data_dir(app: &AppHandle) -> Option<PathBuf> {
    // `APPDATA` is %APPDATA% (Roaming). We do not use data_dir():
    // appDirectoriesOverride may change it too, and the old directory must be
    // found by exactly the old path.
    if let Some(dir) = std::env::var_os("APPDATA") {
        return Some(PathBuf::from(dir).join(LEGACY_DATA_DIR));
    }
    app.path()
        .data_dir()
        .ok()
        .map(|dir| dir.join(LEGACY_DATA_DIR))
}

/// The old `%LOCALAPPDATA%\com.kmaruda.phonebook` contains only the cache,
/// WebView2 profile and logs. After the main data is transferred it can be removed,
/// so the profile does not keep a second, no-longer-used folder.
fn cleanup_legacy_local_data(app: &AppHandle) {
    let old_dir = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| app.path().local_data_dir().ok())
        .map(|dir| dir.join(LEGACY_DATA_DIR));
    let Some(old_dir) = old_dir else {
        return;
    };
    if !old_dir.is_dir() {
        return;
    }
    match fs::remove_dir_all(&old_dir) {
        Ok(()) => info!(path = %old_dir.display(), "старый каталог локальных данных удалён"),
        Err(error) => {
            warn!(path = %old_dir.display(), %error, "не удалось удалить старый каталог локальных данных")
        }
    }
}

/// Extracted separately to test the transfer without a Tauri `AppHandle`.
fn migrate_legacy_dir(old_dir: &Path, new_dir: &Path) -> std::io::Result<bool> {
    if !old_dir.is_dir() || old_dir == new_dir {
        return Ok(false);
    }

    if !new_dir.exists() {
        if let Some(parent) = new_dir.parent() {
            fs::create_dir_all(parent)?;
        }
        if fs::rename(old_dir, new_dir).is_ok() {
            return Ok(true);
        }
    }

    fs::create_dir_all(new_dir)?;
    for entry in fs::read_dir(old_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let destination = new_dir.join(entry.file_name());
        if !destination.exists() {
            fs::copy(entry.path(), destination)?;
        }
    }
    // The files are already copied; the old directory is no longer needed.
    fs::remove_dir_all(old_dir)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kmaruda-state-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn migrates_legacy_directory_when_new_does_not_exist() {
        let root = temp_dir("rename");
        let old = root.join(LEGACY_DATA_DIR);
        let new = root.join("KMAruda PhoneBook");
        fs::create_dir_all(&old).expect("old dir");
        fs::write(old.join("config.json"), b"{}").expect("config");
        fs::write(old.join("phonebook.db"), b"db").expect("db");

        assert!(migrate_legacy_dir(&old, &new).expect("migrate"));
        assert!(!old.exists());
        assert_eq!(fs::read(new.join("config.json")).expect("config"), b"{}");
        assert_eq!(fs::read(new.join("phonebook.db")).expect("db"), b"db");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn merges_missing_files_when_new_directory_exists() {
        let root = temp_dir("merge");
        let old = root.join(LEGACY_DATA_DIR);
        let new = root.join("KMAruda PhoneBook");
        fs::create_dir_all(&old).expect("old dir");
        fs::create_dir_all(&new).expect("new dir");
        fs::write(old.join("config.json"), b"old").expect("old config");
        fs::write(old.join("phonebook.db"), b"old db").expect("old db");
        fs::write(new.join("config.json"), b"new").expect("new config");

        assert!(migrate_legacy_dir(&old, &new).expect("migrate"));
        assert!(!old.exists());
        assert_eq!(fs::read(new.join("config.json")).expect("config"), b"new");
        assert_eq!(fs::read(new.join("phonebook.db")).expect("db"), b"old db");
        fs::remove_dir_all(root).ok();
    }
}
