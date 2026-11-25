pub mod config;
pub mod contacts;
pub mod sync;
pub mod system;
pub mod vcard;

use crate::error::AppError;

/// Run blocking work off the main thread.
///
/// In Tauri v2, **synchronous** commands run on the window's main thread
/// (the window/WebView event loop). Waiting for the cache mutex in such a command
/// (e.g. while background sync holds it in a large transaction)
/// freezes the whole window: it does not print input, cannot be dragged by the title bar,
/// the cursor is not updated. Therefore all commands accessing SQLite,
/// configuration or keyring, are wrapped in `spawn_blocking`: the main thread
/// only waits for the ready result in an async task; the window stays responsive.
pub(crate) async fn run_blocking<F, T>(job: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| AppError::Internal(format!("блокирующая задача завершилась аварией: {e}")))?
}
