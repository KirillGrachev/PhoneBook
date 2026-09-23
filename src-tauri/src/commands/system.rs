//! Системные команды: трей, открытие внешних ссылок, devtools, dev-лог.

use tauri::AppHandle;
use tracing::info;

use crate::error::AppError;

/// Схемы URL, которые разрешено открывать во внешней программе.
/// Всё остальное (file:, javascript:, произвольные exe-схемы) отклоняется.
const ALLOWED_SCHEMES: [&str; 6] = ["http", "https", "mailto", "tel", "callto", "trueconf"];

/// Обновляет пункты меню трея текущими строками из i18n фронтенда.
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

/// Открывает URL во внешней программе (почта, TrueConf, браузер).
///
/// Реализовано через прямой запуск OS-хелпера **без командной оболочки**,
/// поэтому shell-инъекции через содержимое URL невозможны; схема и символы
/// дополнительно валидируются по allow-list.
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

/// Открывает DevTools. Работает только в debug-сборке: в release команда
/// зарегистрирована, но является no-op (devtools-фича tauri не включена).
#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = window;
}

/// Печатает запись фронтового dev-логгера в терминале.
///
/// В dev-режиме (`npm run tauri dev`) фронтенд дублирует свои `devLog`
/// в stdout процесса — ту же консоль, куда уже пишут Vite и tracing
/// Rust-части. В release команда не вызывается: фронтенд вырезает
/// вызовы `devLog` на этапе сборки (`import.meta.env.DEV`), а GUI-процесс
/// без консоли (`windows_subsystem = "windows"`) никуда не пишет.
#[tauri::command]
pub fn dev_log(scope: String, message: String) {
    info!(target: "frontend", "[phonebook:{scope}] {message}");
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
