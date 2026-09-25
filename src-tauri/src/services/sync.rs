//! Оркестрация синхронизации Active Directory → локальный кэш.
//!
//! Ключевые свойства:
//! * **Single-flight**: одновременный запуск невозможен (ручная кнопка,
//!   стартовое расписание и периодический тик не пересекаются).
//! * **Неблокирующий UI**: синхронизация всегда фоновая, фронтенд получает
//!   live-события `directory-sync` (started/progress/finished/error/runFinished)
//!   и инвалидирует кэши react-query по завершении.
//! * **Свежесть кэша**: планировщик запускает синхронизацию, только если
//!   [`crate::services::policy::needs_sync`] говорит, что кэш пуст или устарел.
//! * Ошибка одной организации не прерывает синхронизацию остальных;
//!   последняя ошибка сохраняется в `sync_meta` и видна в настройках.

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

/// Имя Tauri-события с прогрессом синхронизации.
pub const SYNC_EVENT: &str = "directory-sync";

/// Пауза перед первой проверкой при старте приложения — даём UI отрисоваться.
const STARTUP_DELAY: Duration = Duration::from_secs(6);
/// Как часто планировщик проверяет свежесть кэша.
const SCHEDULE_TICK: Duration = Duration::from_secs(20 * 60);

/// События синхронизации для фронтенда.
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

/// Состояние синхронизации организации (для UI настроек).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgSyncState {
    pub organization: String,
    pub running: bool,
    pub last_sync_at: Option<i64>,
    pub last_count: Option<i64>,
    pub last_error: Option<String>,
}

/// Совокупный статус для команды `get_sync_status`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub running: bool,
    pub organizations: Vec<OrgSyncState>,
}

#[derive(Default)]
struct Inner {
    running: AtomicBool,
    /// Single-flight «ворота»: удерживаются на всё время прогона.
    gate: AsyncMutex<()>,
    running_orgs: Mutex<Vec<String>>,
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

    /// Запускает синхронизацию в фоне, не блокируя вызывающего.
    /// Возвращает `false`, если прогон уже идёт.
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

    /// Полный прогон синхронизации (single-flight).
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
        let config = ConfigStore::load(&state.config_dir)?;

        if config.test_mode {
            info!("тестовый режим: синхронизация с AD пропущена");
            return Ok(());
        }

        // Внешний телефонный файл не зависит от подключений AD: грузим до
        // проверки организаций, чтобы справочник работал и без каталога.
        refresh_external(&state.db, &config);

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

        // Организации синхронизируются последовательно: не создаём
        // параллельную нагрузку на контроллеры домена.
        for org in orgs {
            self.sync_org(app, &state.db, org).await;
        }
        Ok(())
    }

    async fn sync_org(&self, app: &AppHandle, db: &Db, org: &LdapOrgConfig) {
        let name = org.organization.clone();
        emit(
            app,
            SyncEvent::Started {
                organization: name.clone(),
            },
        );
        self.set_org_running(&name, true);
        let started = Instant::now();

        let password = ConfigStore::get_password(&name);
        let credentials = DirectoryCredentials {
            ldap_url: org.ldap_url.as_str(),
            base_dn: org.base_dn.as_str(),
            bind_dn: org.bind_dn.as_deref(),
            password: password.as_deref(),
            use_start_tls: org.use_start_tls,
            allow_invalid_tls: org.allow_invalid_tls,
            use_integrated_auth: org.use_integrated_auth,
        };

        let progress_app = app.clone();
        let progress_org = name.clone();
        let fetched = ldap::fetch_users(credentials, move |count| {
            emit(
                &progress_app,
                SyncEvent::Progress {
                    organization: progress_org.clone(),
                    fetched: count,
                },
            );
        })
        .await;

        match fetched {
            Ok(raw_users) => {
                let user_records = records::build_records(raw_users);
                match db.replace_org_users(&name, &user_records) {
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

    /// Совокупный статус: персистентная мета из БД + live-состояние.
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

        // Организации из конфига без меты (ещё ни разу не синхронизировались).
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

    /// Фоновый планировщик: стартовая проверка + периодический контроль свежести.
    pub fn spawn_scheduler(self, app: AppHandle) {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(STARTUP_DELAY).await;
            loop {
                let state = app.state::<AppState>().inner().clone();
                match ConfigStore::load(&state.config_dir) {
                    Ok(config) => {
                        if policy::needs_sync(&state.db, &config) {
                            info!("кэш устарел или пуст — запускаю фоновую синхронизацию");
                            self.run(&app, false).await;
                        } else {
                            // Синхронизация AD не нужна: внешний файл всё
                            // равно перечитываем (правку файла пользователь
                            // не сопровождает кнопкой).
                            refresh_external(&state.db, &config);
                        }
                    }
                    Err(e) => warn!(error = %e, "планировщик: не удалось прочитать конфигурацию"),
                }
                tokio::time::sleep(SCHEDULE_TICK).await;
            }
        });
    }
}

/// Загрузка внешнего телефонного файла по текущей конфигурации.
/// Ошибка (файл удалён, битый XML) не прерывает синхронизацию: логируется.
fn refresh_external(db: &Db, config: &AppConfig) {
    match external::refresh(
        db,
        config.external_phonebook_enabled,
        config.external_phonebook_path.as_deref(),
    ) {
        Ok(external::ExternalRefresh::Loaded {
            organization,
            count,
        }) => {
            info!(organization = %organization, count, "внешний телефонный файл загружен");
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
