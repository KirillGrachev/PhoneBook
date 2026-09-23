pub mod config;
pub mod contacts;
pub mod sync;
pub mod system;
pub mod vcard;

use crate::error::AppError;

/// Выполнить блокирующую работу вне главного потока.
///
/// В Tauri v2 **синхронные** команды исполняются на главном потоке окна
/// (цикл событий окна/WebView). Ожидание мьютекса кэша в такой команде
/// (например, пока фоновая синхронизация держит его в большой транзакции)
/// замораживает всё окно: не печатает ввод, не тянется за заголовок,
/// курсор не обновляется. Поэтому все команды, обращающиеся к SQLite,
/// конфигурации или keyring, обёрнуты в `spawn_blocking`: главный поток
/// лишь ждёт готовый результат в async-задаче, окно остаётся отзывчивым.
pub(crate) async fn run_blocking<F, T>(job: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| AppError::Internal(format!("блокирующая задача завершилась аварией: {e}")))?
}
