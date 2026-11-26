//! Directory commands.
//!
//! All selections come from the local SQLite cache - but run in a pool
//! blocking tasks via [`super::run_blocking`]: synchronous commands
//! Tauri v2 run on the window's main thread, and waiting for the cache mutex
//! (background sync holds it in a large transaction) would freeze
//! the whole UI. An async command hands the wait to the runtime; the window stays alive.

use std::sync::atomic::Ordering;

use tauri::State;

use crate::error::AppError;
use crate::services::db::{DuplicatesPreview, Employee, SearchPage, SearchParams};
use crate::state::AppState;

use super::run_blocking;

/// Contact search/browse.
///
/// The whole request contract is described by [`SearchParams`] (deserialized from
/// IPC payload; all fields are optional):
/// * `ids` - exact selection (the "My contacts" tab);
/// * `query` - full-text search (FTS5 + LIKE complement, keyboard layouts);
/// * `organization`/`organizations`/`source_org`/`department` - filters
///   (`organization` - by the AD `company` attribute with name normalization:
///   an exact key or the single lookup containing it;
///   `organizations` - union of organizations of the filter group from settings:
/// each name is resolved as `organization`; results consider the
///   union; an unresolved strict group returns nothing;
///   `source_org` - by the sync source organization; includes accounts
///   without `company`; a pair of identical `organization`+`source_org` names -
///   enterprise tab fallback to the source if the name is not found in
/// `company`; for `organizations` the same fallback triggers when
///   no group name was resolved);
/// * `title`/`office` - exact filters: clicking a job title or office
///   in the card opens the list of people with the same job title / in the same
///   office (analogous to the `department` filter);
/// * `hide_empty` (default `true`) - hide accounts without email and phones;
/// * without parameters - an alphabetical list limited by `limit`.
#[tauri::command]
pub async fn search_contacts(
    state: State<'_, AppState>,
    mut params: SearchParams,
) -> Result<SearchPage, AppError> {
    // The IPC boundary does not trust the request size: without a clamp a single call could
    // request the whole catalog, a giant offset, or tens of thousands of ids.
    params.limit = Some(params.limit.unwrap_or(300).clamp(1, 1_000));
    params.offset = Some(params.offset.unwrap_or(0).min(1_000_000));
    if let Some(query) = params.query.as_mut() {
        if query.chars().count() > 512 {
            *query = query.chars().take(512).collect();
        }
    }
    if let Some(ids) = params.ids.as_mut() {
        if ids.is_empty() {
            return Ok(SearchPage {
                items: Vec::new(),
                total: 0,
            });
        }
        ids.truncate(5_000);
    }

    let db = state.db.clone();
    let latest = state.search_latest.clone();
    let cache = state.search_cache.clone();
    let request_id = params.request_id;
    if let Some(id) = request_id {
        latest.fetch_max(id, Ordering::SeqCst);
    }

    run_blocking(move || {
        // While the request waited for the DB mutex, the user might have typed the next one.
        // We do not run stale work: we return the last ready page.
        if let Some(id) = request_id {
            if id < latest.load(Ordering::SeqCst) {
                if let Ok(guard) = cache.lock() {
                    if let Some((_, page)) = guard.as_ref() {
                        return Ok(page.clone());
                    }
                }
                return Ok(SearchPage {
                    items: Vec::new(),
                    total: 0,
                });
            }
        }

        let page = db.search(params)?;
        if let Some(id) = request_id {
            if id >= latest.load(Ordering::SeqCst) {
                if let Ok(mut guard) = cache.lock() {
                    *guard = Some((id, page.clone()));
                }
            }
        }
        Ok(page)
    })
    .await
}

/// Contact card by GUID.
#[tauri::command]
pub async fn get_contact(state: State<'_, AppState>, id: String) -> Result<Employee, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.get_by_id(&id)).await
}

/// Avatar of a contact as a `data:` URL, or `null` when there is no photo.
///
/// Fetched lazily for the open card only, so search pages stay small. The MIME
/// type is sniffed from the magic bytes (AD `thumbnailPhoto` is usually JPEG).
#[tauri::command]
pub async fn get_contact_photo(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<String>, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let bytes = db.get_photo(&id)?;
        Ok(bytes.and_then(|bytes| {
            let mime = sniff_image_mime(&bytes)?;
            Some(format!(
                "data:{mime};base64,{}",
                crate::services::base64::encode(&bytes)
            ))
        }))
    })
    .await
}

/// Detects the image MIME type from magic bytes; `None` for unknown payloads.
fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        Some("image/png")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else {
        None
    }
}

/// Organization list for the filter.
#[tauri::command]
pub async fn list_organizations(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.list_organizations()).await
}

/// Total number of contacts in the cache (first-run UX).
#[tauri::command]
pub async fn count_contacts(state: State<'_, AppState>) -> Result<u64, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.count()).await
}

/// Account duplicate preview: how many clusters and records the cleanup will remove
/// (the match rule is in [`crate::services::db::dedup`]).
#[tauri::command]
pub async fn preview_duplicate_contacts(
    state: State<'_, AppState>,
) -> Result<DuplicatesPreview, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.duplicates_preview()).await
}

/// Duplicate cleanup: returns the number of deleted records.
#[tauri::command]
pub async fn deduplicate_contacts(state: State<'_, AppState>) -> Result<usize, AppError> {
    let db = state.db.clone();
    run_blocking(move || db.deduplicate()).await
}
