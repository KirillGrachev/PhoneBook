//! Команды конфигурации, обмена настройками и диагностики подключений.

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tracing::warn;

use crate::error::AppError;
use crate::services::config::{
    AppConfig, ConfigShareFile, ConfigStore, LdapOrgInput, OrgGroupsShareFile, SaveConfigRequest,
    CONFIG_SHARE_FILE_NAME, SHARE_FILE_NAME,
};
use crate::services::ldap::{self, ConnectionTest, DirectoryCredentials};
use crate::services::{external, external::ExternalRefresh};
use crate::state::AppState;

use super::run_blocking;

/// Загрузка конфигурации. Пароли не возвращаются — только флаг `hasPassword`.
///
/// Дисковый I/O вынесен в пул блокирующих задач: синхронные команды Tauri v2
/// исполняются на главном потоке окна и подвесили бы UI на время чтения.
#[tauri::command]
pub async fn load_config(state: State<'_, AppState>) -> Result<AppConfig, AppError> {
    let config_dir = state.config_dir.clone();
    run_blocking(move || ConfigStore::load(&config_dir)).await
}

/// Сохранение конфигурации (без секретов). Возвращает итоговую конфигурацию,
/// чтобы фронтенд синхронизировал нормализованные значения (trim, флаги).
#[tauri::command]
pub async fn save_config(
    state: State<'_, AppState>,
    config: SaveConfigRequest,
) -> Result<AppConfig, AppError> {
    let config_dir = state.config_dir.clone();
    run_blocking(move || ConfigStore::save(&config_dir, config)).await
}

/// Управление секретом bind-учётки: `Some(password)` — сохранить,
/// `None` — удалить. Отдельная команда, чтобы пароли никогда не путешествовали
/// вместе с конфигурацией и не оседали в сторе фронтенда.
///
/// Обращение к системному keyring может занимать секунды (особенно первое) —
/// поэтому тоже вне главного потока.
#[tauri::command]
pub async fn set_ldap_password(
    organization: String,
    password: Option<String>,
) -> Result<(), AppError> {
    run_blocking(move || ConfigStore::set_password(&organization, password)).await
}

/// Экспорт групп организаций в файл обмена: «Документы/KMARUDA Phonebook/
/// kmaruda-org-groups.json». Возвращает полный путь записанного файла —
/// UI показывает его с кнопкой копирования, чтобы файлом можно было
/// поделиться. Группы и отметка вкладки предприятия берутся из сохранённой
/// конфигурации (единый источник правды, не из черновиков стора).
#[tauri::command]
pub async fn export_org_groups_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let config_dir = state.config_dir.clone();
    run_blocking(move || {
        let config = ConfigStore::load(&config_dir)?;
        let file = OrgGroupsShareFile::new(
            config.org_groups.clone(),
            config.enterprise_group_id.clone(),
        );
        let dir = share_dir(&app)?;
        let path = dir.join(SHARE_FILE_NAME);
        std::fs::write(&path, file.render())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// Разбор содержимого файла обмена группами (выбор файла — нативный
/// `<input type="file">` webview, чтение — на фронтенде). Валидация формата
/// живёт в Rust ([`OrgGroupsShareFile::parse`]): фронтенд не применяет
/// непроверенные данные. Слияние с локальными группами выполняет фронтенд
/// (чистая функция с unit-тестами), персист — через обычный save_config.
#[tauri::command]
pub async fn parse_org_groups_file(content: String) -> Result<OrgGroupsShareFile, AppError> {
    run_blocking(move || OrgGroupsShareFile::parse(&content)).await
}

/// Загрузка внешнего телефонного файла (Yealink IPPhoneBook) в кэш по
/// текущей сохранённой конфигурации: путь и признак берутся с диска, поэтому
/// фронтенд перед вызовом сбрасывает дебаунс сохранения.
#[tauri::command]
pub async fn refresh_external_phonebook(
    state: State<'_, AppState>,
) -> Result<ExternalRefresh, AppError> {
    let db = state.db.clone();
    let config_dir = state.config_dir.clone();
    run_blocking(move || {
        let config = ConfigStore::load(&config_dir)?;
        external::refresh(
            &db,
            config.external_phonebook_enabled,
            config.external_phonebook_path.as_deref(),
        )
    })
    .await
}

/// Нативный диалог выбора XML-файла телефонной книги. Возвращает `None`,
/// если пользователь закрыл диалог: отмена — не ошибка.
#[tauri::command]
pub async fn pick_external_phonebook_file(app: AppHandle) -> Result<Option<String>, AppError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Выберите файл телефонной книги")
        .add_filter("XML (*.xml)", &["xml"])
        .pick_file(move |picked| {
            // `into_path` возвращает Result: выбор из диалога теоретически может
            // быть URL, а не локальным путём. Для файлового диалога это недостижимо,
            // но молча терять путь нельзя — логируем и трактуем как отмену.
            let _ = sender.send(picked.and_then(|value| match value.into_path() {
                Ok(path) => Some(path),
                Err(error) => {
                    warn!(error = %error, "выбранный файл не является локальным путём");
                    None
                }
            }));
        });
    Ok(receiver
        .await
        .ok()
        .flatten()
        .map(|path| path.to_string_lossy().into_owned()))
}

/// Экспорт всей конфигурации в файл обмена: «Документы/KMARUDA Phonebook/
/// kmaruda-config.json». Секреты LDAP не покидают машину: флаг `hasPassword`
/// сбрасывается, пароли остаются в системном хранилище.
#[tauri::command]
pub async fn export_config_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let config_dir = state.config_dir.clone();
    run_blocking(move || {
        let mut config = ConfigStore::load(&config_dir)?;
        for org in &mut config.ldap_configs {
            org.has_password = false;
        }
        let file = ConfigShareFile::new(config);
        let dir = share_dir(&app)?;
        let path = dir.join(CONFIG_SHARE_FILE_NAME);
        std::fs::write(&path, file.render())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// Разбор содержимого файла обмена конфигурацией (выбор файла — нативный
/// `<input type="file">` webview, чтение — на фронтенде). Валидация формата
/// живёт в Rust ([`ConfigShareFile::parse`]): фронтенд не применяет
/// непроверенные данные. Применение к стору выполняет фронтенд, персист —
/// через обычный save_config.
#[tauri::command]
pub async fn parse_config_file(content: String) -> Result<AppConfig, AppError> {
    run_blocking(move || ConfigShareFile::parse(&content)).await
}

/// Папка файлов обмена: «Документы/KMARUDA Phonebook».
fn share_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| AppError::Config(format!("не удалось определить папку «Документы»: {e}")))?;
    let dir = dir.join("KMARUDA Phonebook");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
/// Диагностика подключения: bind, rootDSE, пробная выборка сотрудников.
///
/// `passwordOverride` позволяет проверить ещё не сохранённый пароль;
/// если он не задан, берётся сохранённый секрет организации.
#[tauri::command]
pub async fn test_ldap_connection(
    org: LdapOrgInput,
    password_override: Option<String>,
) -> Result<ConnectionTest, AppError> {
    let stored_password = ConfigStore::get_password(&org.organization);
    let password = password_override
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .or(stored_password);

    let credentials = DirectoryCredentials {
        ldap_url: org.ldap_url.as_str(),
        base_dn: org.base_dn.as_str(),
        bind_dn: org.bind_dn.as_deref(),
        password: password.as_deref(),
        use_start_tls: org.use_start_tls,
        allow_invalid_tls: org.allow_invalid_tls,
        use_integrated_auth: org.use_integrated_auth,
    };
    ldap::test_connection(credentials).await
}
