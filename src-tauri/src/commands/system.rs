//! System commands: tray, opening external links, devtools, dev log.

use tauri::AppHandle;
use tracing::{debug, error, info, warn};

use crate::error::AppError;

/// URL schemes allowed to be opened in an external program.
/// Everything else (file:, javascript:, arbitrary exe schemes) is rejected.
const ALLOWED_SCHEMES: [&str; 6] = ["http", "https", "mailto", "tel", "callto", "trueconf"];

/// Updates tray menu items with the current i18n strings from the frontend.
#[tauri::command]
pub fn update_tray_menu(
    app: AppHandle,
    open_text: String,
    quit_text: String,
) -> Result<(), AppError> {
    #[cfg(desktop)]
    {
        use tauri::menu::{Menu, MenuItem};

        if let Some(tray) = app.tray_by_id(crate::TRAY_ID) {
            let show_item = MenuItem::with_id(&app, "show", open_text, true, None::<&str>)
                .map_err(|e| AppError::Internal(e.to_string()))?;
            let quit_item = MenuItem::with_id(&app, "quit", quit_text, true, None::<&str>)
                .map_err(|e| AppError::Internal(e.to_string()))?;
            let menu = Menu::with_items(&app, &[&show_item, &quit_item])
                .map_err(|e| AppError::Internal(e.to_string()))?;
            tray.set_menu(Some(menu))
                .map_err(|e| AppError::Internal(e.to_string()))?;
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = (&app, open_text, quit_text);
    }
    Ok(())
}

/// Opens a URL in an external program (mail, TrueConf, browser).
///
/// Implemented by launching the OS helper directly **without a command shell**,
/// so shell injections via URL content are impossible; the scheme and characters
/// additionally validated against an allow-list.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), AppError> {
    validate_external_url(&url)?;

    #[cfg(target_os = "windows")]
    let (program, prefix): (&str, Option<&str>) = ("rundll32", Some("url.dll,FileProtocolHandler"));
    #[cfg(target_os = "macos")]
    let (program, prefix): (&str, Option<&str>) = ("open", None);
    #[cfg(all(unix, not(target_os = "macos")))]
    let (program, prefix): (&str, Option<&str>) = ("xdg-open", None);

    let mut command = std::process::Command::new(program);
    if let Some(prefix) = prefix {
        command.arg(prefix);
    }
    command.arg(&url);

    command
        .spawn()
        .map_err(|e| AppError::Internal(format!("не удалось открыть ссылку ({program}): {e}")))?;
    Ok(())
}

fn validate_external_url(url: &str) -> Result<(), AppError> {
    const MAX_LEN: usize = 2048;

    if url.len() > MAX_LEN {
        return Err(AppError::Validation("Ссылка слишком длинная".into()));
    }
    if url
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || c == '"' || c == '\'')
    {
        return Err(AppError::Validation(
            "Ссылка содержит недопустимые символы".into(),
        ));
    }
    let scheme = url
        .split_once("://")
        .map(|(scheme, _)| scheme)
        .or_else(|| url.split_once(':').map(|(scheme, _)| scheme))
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| AppError::Validation("Ссылка без схемы".into()))?;

    if !ALLOWED_SCHEMES.contains(&scheme.as_str()) {
        return Err(AppError::Validation(format!(
            "Схема «{scheme}» не разрешена к открытию"
        )));
    }
    Ok(())
}

/// Opens DevTools. Works only in a debug build: in release the command
/// registered but is a no-op (the tauri devtools feature is not enabled).
#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = window;
}

/// Prints a frontend dev logger record in the terminal.
///
/// In dev mode (`npm run tauri dev`) the frontend duplicates its `devLog`
/// into the process stdout - the same console Vite and tracing already write to -
/// via this Rust command. In release the command is not called: the frontend strips
/// `devLog` calls at the build stage (`import.meta.env.DEV`), while the GUI process
/// has no console (`windows_subsystem = "windows"`) and writes nowhere.
#[tauri::command]
pub fn dev_log(scope: String, message: String) {
    info!(target: "frontend", "[phonebook:{scope}] {message}");
}

/// Writing a frontend error to the release build's file log. Called from
/// ErrorBoundary and window handlers, where `console.*` is unavailable to the user.
#[tauri::command]
pub fn frontend_log(level: String, scope: String, message: String) {
    let scope: String = scope.chars().take(64).collect();
    let message: String = message.chars().take(4096).collect();
    match level.as_str() {
        "error" => error!(target: "frontend", "[phonebook:{scope}] {message}"),
        "warn" => warn!(target: "frontend", "[phonebook:{scope}] {message}"),
        "debug" => debug!(target: "frontend", "[phonebook:{scope}] {message}"),
        _ => info!(target: "frontend", "[phonebook:{scope}] {message}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_expected_schemes() {
        for url in [
            "https://github.com/KirillGrachev",
            "http://intranet.local/page",
            "mailto:ivanov@kmaruda.ru",
            "tel:+74951234567",
            "trueconf:chat:ivanov",
        ] {
            assert!(
                validate_external_url(url).is_ok(),
                "{url} должен быть разрешён"
            );
        }
    }

    #[test]
    fn rejects_dangerous_urls() {
        for url in [
            "file:///C:/Windows/system32",
            "javascript:alert(1)",
            "ftp://host/file",
            "https://ok.ru\" & calc.exe",
            "https://ok.ru\nX-Injected: 1",
            "no-scheme-at-all",
            &format!("https://{}", "a".repeat(3000)),
        ] {
            assert!(
                validate_external_url(url).is_err(),
                "{url} должен быть отклонён"
            );
        }
    }
}
