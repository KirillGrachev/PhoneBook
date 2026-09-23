//! Команды конфигурации и диагностики подключений к каталогу.

use tauri::{AppHandle, Manager, State};

use crate::error::AppError;
use crate::services::config::{
    AppConfig, ConfigStore, LdapOrgInput, OrgGroupsShareFile, SaveConfigRequest, SHARE_FILE_NAME,
};
use crate::services::ldap::{self, ConnectionTest, DirectoryCredentials};
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
        let dir = app.path().document_dir().map_err(|e| {
            AppError::Config(format!("не удалось определить папку «Документы»: {e}"))
        })?;
        let dir = dir.join("KMARUDA Phonebook");
        std::fs::create_dir_all(&dir)?;
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
