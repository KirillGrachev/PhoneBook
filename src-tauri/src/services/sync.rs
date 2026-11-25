//! Orchestration of Active Directory -> local cache sync.
//!
//! Key properties:
//! * **Single-flight**: simultaneous runs are impossible (manual button,
//!   the initial schedule and the periodic tick do not overlap).
//! * **Non-blocking UI**: sync is always background; the frontend receives
//!   live `directory-sync` events (started/progress/finished/error/runFinished)
//!   and invalidates react-query caches on completion.
//! * **Cache freshness**: the scheduler runs sync only if
//!   [`crate::services::policy::needs_sync`] says the cache is empty or stale.
//! * An error in one organization does not interrupt sync of the others;
//!   the last error is saved in `sync_meta` and visible in settings.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as AsyncMutex;
use tracing::{info, warn};

use crate::error::AppError;
use crate::services::config::{AppConfig, ConfigStore, LdapOrgConfig};
use crate::services::db::Db;
use crate::services::ldap::{self, DirectoryCredentials};
use crate::services::{external, policy, records};
use crate::state::AppState;

/// Tauri event name with sync progress.
pub const SYNC_EVENT: &str = "directory-sync";

/// Pause before the first check at application startup - let the UI render.
const STARTUP_DELAY: Duration = Duration::from_secs(6);
/// How often the scheduler checks cache freshness.
const SCHEDULE_TICK: Duration = Duration::from_secs(20 * 60);
/// A full selection is needed for deletions: the delta does not see AD tombstones.
const FULL_SYNC_INTERVAL: i64 = 24 * 60 * 60;

/// Sync events for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum SyncEvent {
    Started {
        organization: String,
    },
    Progress {
        organization: String,
        fetched: usize,
    },
    Finished {
        organization: String,
        count: usize,
        duration_ms: u64,
    },
    Error {
        organization: String,
        code: String,
        message: String,
    },
    RunFinished,
}

/// Organization sync state (for the settings UI).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgSyncState {
    pub organization: String,
    pub running: bool,
    pub last_sync_at: Option<i64>,
    pub last_count: Option<i64>,
    pub last_error: Option<String>,
}

/// Aggregate status for the `get_sync_status` command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub running: bool,
    pub organizations: Vec<OrgSyncState>,
}

#[derive(Default)]
struct Inner {
    running: AtomicBool,
    /// Single-flight "gate": held for the entire run.
    gate: AsyncMutex<()>,
    running_orgs: Mutex<Vec<String>>,
    /// Last successful batch read of external XML files, keyed by path.
    external_last_refresh: Mutex<HashMap<String, Instant>>,
}

#[derive(Clone)]
pub struct SyncManager {
    inner: Arc<Inner>,
}

impl Default for SyncManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SyncManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner::default()),
        }
    }

    pub fn is_running(&self) -> bool {
        self.inner.running.load(Ordering::SeqCst)
    }

    fn mark_external_refreshed(&self, paths: &[String]) {
        let now = Instant::now();
        let mut last = self
            .inner
            .external_last_refresh
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for path in paths {
            last.insert(path.clone(), now);
        }
    }

    /// True when at least one selected file has a configured interval that has
    /// elapsed. External files are still re-read as one atomic batch.
    fn external_refresh_due(&self, config: &AppConfig) -> bool {
        let last = self
            .inner
            .external_last_refresh
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        config.external_phonebook_paths.iter().any(|path| {
            let hours = config
                .external_phonebook_intervals
                .get(path)
                .copied()
                .unwrap_or(0);
            if hours == 0 {
                return false;
            }
            last.get(path)
                .map(|instant| instant.elapsed() >= Duration::from_secs(u64::from(hours) * 3600))
                .unwrap_or(true)
        })
    }

    /// Starts sync in the background without blocking the caller.
    /// Returns `false` if a run is already in progress.
    pub fn spawn(&self, app: AppHandle, force: bool) -> bool {
        if self.is_running() {
            return false;
        }
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            manager.run(&app, force).await;
        });
        true
    }

    /// Full sync run (single-flight).
    pub async fn run(&self, app: &AppHandle, force: bool) {
        let Ok(_guard) = self.inner.gate.try_lock() else {
            info!("синхронизация уже выполняется — новый запуск пропущен");
            return;
        };
        self.inner.running.store(true, Ordering::SeqCst);
        if let Err(e) = self.run_inner(app, force).await {
            warn!(error = %e, "сбой прогона синхронизации");
        }
        self.inner.running.store(false, Ordering::SeqCst);
        emit(app, SyncEvent::RunFinished);
    }

    async fn run_inner(&self, app: &AppHandle, force: bool) -> Result<(), AppError> {
        let state = app.state::<AppState>().inner().clone();
        let config_dir = state.config_dir.clone();
        let config = tokio::task::spawn_blocking(move || ConfigStore::load(&config_dir))
            .await
            .map_err(|e| AppError::Internal(format!("загрузка конфигурации: {e}")))??;

        if config.test_mode {
            info!("тестовый режим: синхронизация с AD пропущена");
            return Ok(());
        }

        // The external phone file does not depend on AD connections: we load before
        // organization checks, so the lookup works even without the catalog.
        refresh_external(&state.db, &config);
        self.mark_external_refreshed(&config.external_phonebook_paths);

        let orgs: Vec<&LdapOrgConfig> = config
            .ldap_configs
            .iter()
            .filter(|org| policy::is_configured(org))
            .collect();

        if orgs.is_empty() {
            if force {
                emit(
                    app,
                    SyncEvent::Error {
                        organization: String::new(),
                        code: AppError::Config(String::new()).code().to_string(),
                        message: "Не указано ни одного подключения к Active Directory".into(),
                    },
                );
            } else {
                info!("подключения к AD не настроены — синхронизация пропущена");
            }
            return Ok(());
        }

        // Organizations are synchronized sequentially: we do not create
        // parallel load on the domain controllers.
        for org in orgs {
            self.sync_org(
                app,
                &state.db,
                org,
                force,
                config.ldap_connect_timeout_secs,
                config.ldap_operation_timeout_secs,
            )
            .await;
        }

        // AD sync may add an employee that was not yet in the cache at
        // the first load of the external file. Reapply the files,
        // to cut off newly appeared Yealink + AD duplicates by full name and contacts.
        if config.external_phonebook_enabled && !config.external_phonebook_paths.is_empty() {
            refresh_external(&state.db, &config);
            self.mark_external_refreshed(&config.external_phonebook_paths);
        }
        Ok(())
    }

    async fn sync_org(
        &self,
        app: &AppHandle,
        db: &Db,
        org: &LdapOrgConfig,
        force: bool,
        connect_timeout_secs: u32,
        operation_timeout_secs: u32,
    ) {
        let name = org.organization.clone();
        emit(
            app,
            SyncEvent::Started {
                organization: name.clone(),
            },
        );
        self.set_org_running(&name, true);
        let started = Instant::now();

        // A delta instead of a full sample: uSNChanged is a monotonic AD marker.
        // The delta does not see tombstones, so once a day or on a manual
        // startup we perform a full selection and remove disappeared records.
        let meta = db
            .sync_meta()
            .unwrap_or_default()
            .into_iter()
            .find(|meta| meta.organization == name);
        let needs_full = force
            || meta.as_ref().and_then(|meta| meta.last_usn).is_none()
            || meta
                .as_ref()
                .and_then(|meta| meta.last_full_sync_at)
                .is_none_or(|last| {
                    crate::services::db::unix_now().saturating_sub(last) >= FULL_SYNC_INTERVAL
                });
        let since = if needs_full {
            None
        } else {
            meta.and_then(|meta| meta.last_usn)
                .map(|usn| usn.saturating_add(1))
        };
        let filter = ldap::user_filter_since(since);

        let password_org = name.clone();
        let password =
            match tokio::task::spawn_blocking(move || ConfigStore::get_password(&password_org))
                .await
            {
                Ok(password) => password,
                Err(error) => {
                    let error = AppError::Internal(format!("keyring: {error}"));
                    report_failure(app, db, &name, &error);
                    self.set_org_running(&name, false);
                    return;
                }
            };
        let credentials = DirectoryCredentials {
            ldap_url: org.ldap_url.as_str(),
            base_dn: org.base_dn.as_str(),
            bind_dn: org.bind_dn.as_deref(),
            password: password.as_deref(),
            use_start_tls: org.use_start_tls,
            allow_invalid_tls: org.allow_invalid_tls,
            use_integrated_auth: org.use_integrated_auth,
            connect_timeout_secs: u64::from(connect_timeout_secs),
            operation_timeout_secs: u64::from(operation_timeout_secs),
        };

        // A transient DC reset should not discard the whole organization:
        // retry the complete fetch with a short exponential backoff. The
        // cache is only written after a successful fetch, so an interrupted
        // attempt cannot leave partial rows.
        let mut attempt = 0u32;
        let fetched = loop {
            let progress_app = app.clone();
            let progress_org = name.clone();
            let result = ldap::fetch_users(credentials.clone(), &filter, move |count| {
                emit(
                    &progress_app,
                    SyncEvent::Progress {
                        organization: progress_org.clone(),
                        fetched: count,
                    },
                );
            })
            .await;

            match result {
                Err(error) if attempt < 2 && is_transient_ldap_error(&error) => {
                    attempt += 1;
                    let delay = Duration::from_millis(500 * 2u64.pow(attempt));
                    warn!(
                        organization = %name,
                        attempt,
                        delay_ms = delay.as_millis() as u64,
                        error = %error,
                        "временная ошибка LDAP — повторяю выборку"
                    );
                    tokio::time::sleep(delay).await;
                }
                other => break other,
            }
        };

        match fetched {
            Ok(raw_users) => {
                let user_records = records::build_records(raw_users);
                let write = if needs_full {
                    db.replace_org_users(&name, &user_records)
                } else {
                    db.merge_org_users(&name, &user_records)
                };
                match write {
                    Ok(count) => {
                        info!(organization = %name, count, "синхронизация организации завершена");
                        emit(
                            app,
                            SyncEvent::Finished {
                                organization: name.clone(),
                                count,
                                duration_ms: started.elapsed().as_millis() as u64,
                            },
                        );
                    }
                    Err(e) => report_failure(app, db, &name, &e),
                }
            }
            Err(e) => report_failure(app, db, &name, &e),
        }

        self.set_org_running(&name, false);
    }

    fn set_org_running(&self, organization: &str, running: bool) {
        if let Ok(mut orgs) = self.inner.running_orgs.lock() {
            orgs.retain(|name| name != organization);
            if running {
                orgs.push(organization.to_string());
            }
        }
    }

    /// Aggregate status: persistent metadata from the DB + live state.
    pub fn status(&self, db: &Db, configured_orgs: &[String]) -> SyncStatus {
        let metas = db.sync_meta().unwrap_or_default();
        let running_orgs = self
            .inner
            .running_orgs
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default();

        let mut organizations: Vec<OrgSyncState> = metas
            .into_iter()
            .map(|meta| OrgSyncState {
                organization: meta.organization.clone(),
                running: running_orgs.contains(&meta.organization),
                last_sync_at: meta.last_sync_at,
                last_count: meta.last_count,
                last_error: meta.last_error,
            })
            .collect();

        // Organizations from the config without meta (never synchronized yet).
        for name in configured_orgs {
            if !organizations
                .iter()
                .any(|state| &state.organization == name)
            {
                organizations.push(OrgSyncState {
                    organization: name.clone(),
                    running: running_orgs.contains(name),
                    last_sync_at: None,
                    last_count: None,
                    last_error: None,
                });
            }
        }

        SyncStatus {
            running: self.is_running(),
            organizations,
        }
    }

    /// Background scheduler: startup check + periodic freshness control.
    pub fn spawn_scheduler(self, app: AppHandle) {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(STARTUP_DELAY).await;
            let mut external_initialized = false;
            loop {
                let state = app.state::<AppState>().inner().clone();
                match ConfigStore::load(&state.config_dir) {
                    Ok(config) => {
                        if policy::needs_sync(&state.db, &config) {
                            info!("кэш устарел или пуст — запускаю фоновую синхронизацию");
                            self.run(&app, false).await;
                        } else if !external_initialized || self.external_refresh_due(&config) {
                            // External files are still re-read as one atomic
                            // batch; the per-file interval decides when the
                            // batch is due.
                            refresh_external(&state.db, &config);
                            self.mark_external_refreshed(&config.external_phonebook_paths);
                        }
                        external_initialized = true;
                    }
                    Err(e) => warn!(error = %e, "планировщик: не удалось прочитать конфигурацию"),
                }
                tokio::time::sleep(SCHEDULE_TICK).await;
            }
        });
    }
}

/// Network/timeout failures are worth retrying; auth, TLS and validation are not.
fn is_transient_ldap_error(error: &AppError) -> bool {
    matches!(error, AppError::LdapUnreachable(_) | AppError::LdapTimeout)
}

/// Loading the external phone file according to the current configuration.
/// An error (file deleted, broken XML) does not interrupt sync: it is logged.
fn refresh_external(db: &Db, config: &AppConfig) {
    match external::refresh(
        db,
        config.external_phonebook_enabled,
        &config.external_phonebook_paths,
        config.external_hide_ad_duplicates,
    ) {
        Ok(external::ExternalRefresh::Loaded { sources, count }) => {
            info!(
                files = sources.len(),
                count, "внешние телефонные файлы загружены"
            );
        }
        Ok(_) => {}
        Err(e) => warn!(error = %e, "внешний телефонный файл не загружен"),
    }
}

fn emit(app: &AppHandle, event: SyncEvent) {
    if let Err(e) = app.emit(SYNC_EVENT, event) {
        warn!(error = %e, "не удалось отправить событие синхронизации");
    }
}

fn report_failure(app: &AppHandle, db: &Db, organization: &str, error: &AppError) {
    warn!(organization, error = %error, "синхронизация организации завершилась ошибкой");
    if let Err(e) = db.set_sync_error(organization, &error.to_string()) {
        warn!(error = %e, "не удалось записать ошибку синхронизации в sync_meta");
    }
    emit(
        app,
        SyncEvent::Error {
            organization: organization.to_string(),
            code: error.code().to_string(),
            message: error.to_string(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_only_transient_ldap_errors() {
        assert!(is_transient_ldap_error(&AppError::LdapTimeout));
        assert!(is_transient_ldap_error(&AppError::LdapUnreachable(
            "reset".into()
        )));
        assert!(!is_transient_ldap_error(&AppError::LdapAuth(
            "bad password".into()
        )));
        assert!(!is_transient_ldap_error(&AppError::LdapTls(
            "bad certificate".into()
        )));
        assert!(!is_transient_ldap_error(&AppError::Validation(
            "bad input".into()
        )));
    }

    #[test]
    fn external_refresh_due_honors_per_file_intervals() {
        let manager = SyncManager::new();
        let mut config = AppConfig {
            external_phonebook_paths: vec!["a.xml".into()],
            ..Default::default()
        };
        config
            .external_phonebook_intervals
            .insert("a.xml".into(), 24);

        assert!(manager.external_refresh_due(&config), "no refresh yet");
        manager.mark_external_refreshed(&config.external_phonebook_paths);
        assert!(!manager.external_refresh_due(&config), "just refreshed");

        config.external_phonebook_paths.push("b.xml".into());
        config
            .external_phonebook_intervals
            .insert("b.xml".into(), 1);
        assert!(
            manager.external_refresh_due(&config),
            "a newly scheduled file is due immediately"
        );

        config.external_phonebook_intervals.clear();
        assert!(
            !manager.external_refresh_due(&config),
            "manual-only files never trigger the scheduler"
        );
    }
}
