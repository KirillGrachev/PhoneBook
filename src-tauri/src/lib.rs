//! Tauri application assembly: plugins, state, tray, hotkeys,
//! background sync and the IPC command registry.
//!
//! `main.rs` is intentionally thin - all composition is here, in the `app_lib` library,
//! so it can be reused in mobile entry points and tests.

mod commands;
mod error;
mod services;
mod state;
mod uninstaller;

use std::sync::OnceLock;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use state::AppState;

/// Tray icon identifier (`update_tray_menu` relies on it).
pub const TRAY_ID: &str = "main-tray";
/// Main window label from `tauri.conf.json`.
const MAIN_WINDOW: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // MSI `UninstallString` starts this executable with `--uninstall`. Handle it
    // before WebView2/Tauri initialization: the uninstaller must work even if
    // the webview runtime is broken, and must not create the single-instance
    // lock or the main window.
    #[cfg(windows)]
    if uninstaller::is_requested() {
        uninstaller::run();
    }

    // Without the WebView2 Runtime there is nothing to create a window with: the process would live only in the tray.
    // We check the runtime before Tauri initialization and talk to the user
    // native dialog; disable the check with KMPB_SKIP_WEBVIEW_CHECK=1.
    #[cfg(target_os = "windows")]
    if std::env::var_os("KMPB_SKIP_WEBVIEW_CHECK").is_none()
        && !services::webview_prereq::webview2_runtime_installed()
    {
        services::webview_prereq::report_missing_runtime();
        std::process::exit(1);
    }

    tauri::Builder::default()
        // Must be registered first (a plugin requirement on Windows).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            info!("запуск второго экземпляра — активирую существующее окно");
            show_main_window(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Visibility is intentionally not restored: the window is shown by
                // the frontend after hydration (and the safety timer below).
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        // Native file dialogs: selecting a phone book XML from settings.
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let toggles = shortcut
                        .matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Space)
                        || shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Space);
                    if toggles {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            init_tracing(app.handle());
            info!(
                version = env!("CARGO_PKG_VERSION"),
                "запуск телефонного справочника"
            );

            let state = AppState::init(app.handle())?;
            app.manage(state);

            init_tray(app)?;
            register_shortcuts(app);

            // Background AD sync scheduler.
            let state = app.state::<AppState>();
            state.sync.clone().spawn_scheduler(app.handle().clone());

            // Window-state might have restored an incorrect (tiny) size
            // window after a crash - return a reasonable size.
            sanitize_main_window_size(app);

            // The product is an app, not a website: we disable WebView web behaviors
            // (autofill of "saved details", zoom, swipes, browser
            // hotkeys, status bar, and the standard context menu).
            harden_main_webview(app);

            // The window/taskbar icon is a built-in brand file, regardless
            // of the exe resource and the Windows icon cache.
            set_main_window_icon(app);

            // Safety net: if the frontend did not show the window itself (JS failure),
            // show it forcibly so the application does not "disappear".
            spawn_window_failsafe(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::config::load_config,
            commands::config::save_config,
            commands::config::set_ldap_password,
            commands::config::export_org_groups_file,
            commands::config::parse_org_groups_file,
            commands::config::refresh_external_phonebook,
            commands::config::pick_external_phonebook_files,
            commands::config::export_config_file,
            commands::config::parse_config_file,
            commands::config::test_ldap_connection,
            commands::contacts::search_contacts,
            commands::contacts::get_contact,
            commands::contacts::get_contact_photo,
            commands::contacts::list_organizations,
            commands::contacts::count_contacts,
            commands::contacts::preview_duplicate_contacts,
            commands::contacts::deduplicate_contacts,
            commands::sync::start_sync,
            commands::sync::get_sync_status,
            commands::vcard::generate_vcard,
            commands::system::update_tray_menu,
            commands::system::open_external,
            commands::system::open_devtools,
            commands::system::dev_log,
            commands::system::frontend_log,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            tracing::error!(%error, "не удалось запустить Tauri-приложение");
            std::process::exit(1);
        });
}

/// The file logger's WorkerGuard must live for the whole process: on its drop
/// a non-blocking writer may lose the queue tail.
static LOG_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();

fn init_tracing(app: &AppHandle) {
    let default_filter = if cfg!(debug_assertions) {
        "app_lib=debug,info"
    } else {
        "info"
    };

    // In release the GUI has no console (windows_subsystem = "windows"), so the log
    // file is the only way to get diagnostics from the user's machine.
    let log_dir = app
        .path()
        .app_log_dir()
        .or_else(|_| app.path().app_data_dir())
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&log_dir);
    let file_appender = tracing_appender::rolling::daily(&log_dir, "phonebook.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_GUARD.set(guard);

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter)))
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(file_writer),
        )
        .init();
    info!(path = %log_dir.display(), "файловый лог инициализирован");
}

fn init_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Открыть контакты", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Телефонный справочник КМАруда")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            show_main_window(tray.app_handle());
        }
    })
    .build(app)?;

    Ok(())
}

fn register_shortcuts(app: &tauri::App) {
    // Ctrl+Shift+Space — show/hide the window (as in the original product).
    if let Err(e) = app
        .global_shortcut()
        .register("CommandOrControl+Shift+Space")
    {
        warn!(error = %e, "не удалось зарегистрировать глобальную горячую клавишу (возможно, занята)");
    }
}

/// Minimum allowed main window size after state restoration.
const MIN_SANITY_WIDTH: u32 = 640;
const MIN_SANITY_HEIGHT: u32 = 480;

/// If the window-state plugin restored a degenerate window size
/// (happens after crashes), set the default size and center it.
fn sanitize_main_window_size(app: &tauri::App) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    // The window is always without a system frame: control is only our TitleBar.
    let _ = window.set_decorations(false);

    if let Ok(size) = window.inner_size() {
        if size.width < MIN_SANITY_WIDTH || size.height < MIN_SANITY_HEIGHT {
            warn!(
                width = size.width,
                height = size.height,
                "восстановлен некорректный размер окна — применяю размер по умолчанию"
            );
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: 1280.0,
                height: 860.0,
            }));
            let _ = window.center();
        }
    }
}

/// The product is an application, not a website: on Windows we disable built-in
/// WebView2 web behavior that has no place in a desktop directory:
/// * form and password autofill ("Saved info" over fields);
/// * Ctrl+wheel zoom and pinch-zoom - the UI is laid out in fixed sizes;
/// * browser accelerators (Ctrl+P, Ctrl+S, Ctrl+F, etc.) and swipe navigation
///   "back/forward": the application has one page, WebView history is not needed;
/// * the link status bar and the standard browser context menu;
/// * DevTools - only in debug builds (the `open_devtools` command is already closed under
///   `debug_assertions`; here the F12 UI itself is also closed).
///
/// Settings are applied through WebView2 COM interfaces (`ICoreWebView2SettingsN`):
/// Tauri does not expose them in `tauri.conf.json`, and the interfaces were added to the SDK
/// gradually, so each block is cast to its own interface: on older
/// environments the missing interface is simply skipped without crashing startup.
#[cfg(target_os = "windows")]
fn harden_main_webview(app: &tauri::App) {
    // The WebView2 interfaces live in the webview2-com bindings (the same ones used by
    // wry/tauri): the `windows` crate has no extended WebView2 settings.
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings3, ICoreWebView2Settings4, ICoreWebView2Settings5,
        ICoreWebView2Settings6,
    };
    use windows::core::Interface;

    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        warn!("главное окно не найдено — веб-поведения не ужесточены");
        return;
    };
    let result = window.with_webview(|webview| {
        // SAFETY: the closure runs on the main thread while the WebView is alive;
        // controller/CoreWebView2/Settings return valid COM objects,
        // calls only set UI settings and do not release
        // pointers. Casts to Settings3..6 are checked QueryInterface calls,
        // each result is checked before use.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let Ok(settings) = core.Settings() else {
                return;
            };
            let _ = settings.SetIsStatusBarEnabled(false);
            let _ = settings.SetAreDefaultContextMenusEnabled(false);
            let _ = settings.SetIsZoomControlEnabled(false);
            if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
                let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
            }
            if let Ok(settings) = settings.cast::<ICoreWebView2Settings4>() {
                let _ = settings.SetIsGeneralAutofillEnabled(false);
                let _ = settings.SetIsPasswordAutosaveEnabled(false);
            }
            if let Ok(settings) = settings.cast::<ICoreWebView2Settings5>() {
                let _ = settings.SetIsPinchZoomEnabled(false);
            }
            if let Ok(settings) = settings.cast::<ICoreWebView2Settings6>() {
                let _ = settings.SetIsSwipeNavigationEnabled(false);
            }
            #[cfg(not(debug_assertions))]
            let _ = settings.SetAreDevToolsEnabled(false);
        }
    });
    if let Err(e) = result {
        warn!(error = %e, "не удалось ужесточить настройки webview");
    }
}

/// On other platforms there is no WebView add-on: a no-op for call uniformity.
#[cfg(not(target_os = "windows"))]
fn harden_main_webview(_app: &tauri::App) {}

/// Window and taskbar button icon - from the brand file embedded in the binary
/// (`include_bytes!`): runtime installation does not depend on the freshness
/// the exe resource, nor the Windows icon cache, nor the shortcut used to launch
/// application. An error here is not fatal: the exe resources remain.
fn set_main_window_icon(app: &tauri::App) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        warn!("главное окно не найдено — иконка не установлена");
        return;
    };
    // PNG is unpacked into RGBA at startup: tauri::image::Image accepts
    // only raw pixels.
    let Ok(decoded) = image::load_from_memory(include_bytes!("../icons/icon.png")) else {
        warn!("встроенная иконка окна не читается");
        return;
    };
    let rgba = decoded.into_rgba8();
    let (width, height) = rgba.dimensions();
    let icon = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
    if let Err(e) = window.set_icon(icon) {
        warn!(error = %e, "не удалось установить иконку окна");
    }
}

fn spawn_window_failsafe(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(6));
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            match window.is_visible() {
                Ok(false) => {
                    warn!("фронтенд не показал окно за 6 секунд — показываю принудительно");
                    let _ = window.show();
                }
                Ok(true) => {}
                Err(e) => warn!(error = %e, "не удалось проверить видимость окна"),
            }
        }
    });
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused {
        let _ = window.hide();
    } else {
        show_main_window(app);
    }
}
