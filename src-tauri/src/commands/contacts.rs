//! Команды работы со справочником.
//!
//! Все выборки идут из локального кэша SQLite — но исполняются в пуле
//! блокирующих задач через [`super::run_blocking`]: синхронные команды
//! Tauri v2 работают на главном потоке окна, и ожидание мьютекса кэша
//! (фоновая синхронизация держит его в большой транзакции) заморозило бы
//! весь UI. Async-команда отдаёт ожидание в runtime, окно остаётся живым.

use tauri::State;

use crate::error::AppError;
use crate::services::db::{DuplicatesPreview, Employee, SearchPage, SearchParams};
use crate::state::AppState;

use super::run_blocking;

/// Поиск/просмотр контактов.
///
/// Контракт запроса целиком описан [`SearchParams`] (десериализуется из
/// IPC-payload; все поля опциональны):
/// * `ids` — точная выборка (вкладка «Мои контакты»);
/// * `query` — полнотекстовый поиск (FTS5 + LIKE-дополнение, раскладки);
/// * `organization`/`organizations`/`source_org`/`department` — фильтры
///   (`organization` — по атрибуту AD `company` с нормализацией имени:
///   точный ключ либо единственный содержащий его справочник;
///   `organizations` — союз организаций группы фильтров из настроек:
///   каждое имя разрешается как `organization`, выдача учитывает
///   объединение, неразрешённая строгая группа не выдаёт ничего;
///   `source_org` — по организации-источнику синхронизации, включает учётки
///   без `company`; пара одинаковых имён `organization`+`source_org` —
///   фолбэк вкладки предприятия на источник, если имя не найдено в
///   `company`; для `organizations` тот же фолбэк срабатывает, когда не
///   разрешилось ни одно имя группы);
/// * `title`/`office` — точные фильтры: клик по должности или кабинету
///   в карточке открывает список людей с той же должностью / в том же
///   кабинете (аналог фильтра `department`);
/// * `hide_empty` (по умолчанию `true`) — скрыть учётки без почты и телефонов;
/// * без параметров — алфавитный список с ограничением `limit`.
#[tauri::command]
pub async fn search_contacts(
    state: State<'_, AppState>,
    params: SearchParams,
) -> Result<SearchPage, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.search(params)).await
}

/// Карточка контакта по GUID.
#[tauri::command]
pub async fn get_contact(state: State<'_, AppState>, id: String) -> Result<Employee, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.get_by_id(&id)).await
}

/// Список организаций для фильтра.
#[tauri::command]
pub async fn list_organizations(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.list_organizations()).await
}

/// Общее число контактов в кэше (UX первого запуска).
#[tauri::command]
pub async fn count_contacts(state: State<'_, AppState>) -> Result<u64, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.count()).await
}

/// Превью дубликатов учётных записей: сколько кластеров и записей уберёт
/// уборка (правило совпадения — в [`crate::services::db::dedup`]).
#[tauri::command]
pub async fn preview_duplicate_contacts(
    state: State<'_, AppState>,
) -> Result<DuplicatesPreview, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.duplicates_preview()).await
}

/// Уборка дубликатов: возвращает число удалённых записей.
#[tauri::command]
pub async fn deduplicate_contacts(state: State<'_, AppState>) -> Result<usize, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.deduplicate()).await
}
