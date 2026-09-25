//! Сборка Tauri-приложения: плагины, состояние, трей, горячие клавиши,
//! фоновая синхронизация и реестр IPC-команд.
//!
//! `main.rs` намеренно тонкий — вся композиция здесь, в библиотеке `app_lib`,
//! чтобы её можно было переиспользовать в мобильных точках входа и тестах.

mod commands;
mod error;
mod services;
mod state;

use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use state::AppState;

/// Идентификатор трей-иконки (на него опирается `update_tray_menu`).
pub const TRAY_ID: &str = "main-tray";
/// Метка главного окна из `tauri.conf.json`.
const MAIN_WINDOW: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Без WebView2 Runtime окно создать нечем: процесс жил бы только в трее.
    // Проверяем рантайм до инициализации Tauri и говорим с пользователем
    // нативным диалогом; отключение проверки — KMPB_SKIP_WEBVIEW_CHECK=1.
    #[cfg(target_os = "windows")]
    if std::env::var_os("KMPB_SKIP_WEBVIEW_CHECK").is_none()
        && !services::webview_prereq::webview2_runtime_installed()
    {
        services::webview_prereq::report_missing_runtime();
        std::process::exit(1);
    }

    tauri::Builder::default()
        // Должен регистрироваться первым (требование плагина на Windows).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            info!("запуск второго экземпляра — активирую существующее окно");
            show_main_window(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Видимость намеренно не восстанавливаем: окно показывает
                // фронтенд после гидрации (и страховочный таймер ниже).
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        // Нативные диалоги файлов: выбор XML телефонной книги из настроек.
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
            init_tracing();
            info!(
                version = env!("CARGO_PKG_VERSION"),
                "запуск телефонного справочника"
            );

            let state = AppState::init(app.handle())?;
            app.manage(state);

            init_tray(app)?;
            register_shortcuts(app);

            // Фоновый планировщик синхронизации AD.
            let state = app.state::<AppState>();
            state.sync.clone().spawn_scheduler(app.handle().clone());

            // Window-state мог восстановить некорректный (крошечный) размер
            // окна после аварийного запуска — возвращаем разумный размер.
            sanitize_main_window_size(app);

            // Продукт — приложение, а не сайт: отключаем веб-поведения WebView
            // (автозаполнение «сохранённых сведений», зум, свайпы, браузерные
            // хоткеи, статус-бар и стандартное контекстное меню).
            harden_main_webview(app);

            // Иконка окна/таскбара — встроенный бренд-файл, независимо от
            // exe-ресурса и кэша иконок Windows.
            set_main_window_icon(app);

            // Страховка: если фронтенд не показал окно сам (сбой JS),
            // показываем его принудительно, чтобы приложение не «пропало».
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
            commands::config::pick_external_phonebook_file,
            commands::config::export_config_file,
            commands::config::parse_config_file,
            commands::config::test_ldap_connection,
            commands::contacts::search_contacts,
            commands::contacts::get_contact,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn init_tracing() {
    let default_filter = if cfg!(debug_assertions) {
        "app_lib=debug,info"
    } else {
        "info"
    };
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter)))
        .with(tracing_subscriber::fmt::layer())
        .init();
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
    // Ctrl+Shift+Space — показать/спрятать окно (как в исходном продукте).
    if let Err(e) = app
        .global_shortcut()
        .register("CommandOrControl+Shift+Space")
    {
        warn!(error = %e, "не удалось зарегистрировать глобальную горячую клавишу (возможно, занята)");
    }
}

/// Минимально допустимый размер главного окна после восстановления состояния.
const MIN_SANITY_WIDTH: u32 = 640;
const MIN_SANITY_HEIGHT: u32 = 480;

/// Если плагин window-state восстановил вырожденный размер окна
/// (случается после аварийных запусков), ставим дефолтный размер и центрируем.
fn sanitize_main_window_size(app: &tauri::App) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    // Окно всегда без системной рамки: управление — только наш TitleBar.
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

/// Продукт — приложение, а не сайт: на Windows отключаем встроенные
/// веб-поведения WebView2, которым не место в десктоп-справочнике:
/// * автозаполнение форм и паролей («Сохранённые сведения» поверх полей);
/// * зум Ctrl+колесо и pinch-zoom — интерфейс свёрстан в фиксированных размерах;
/// * браузерные акселераторы (Ctrl+P, Ctrl+S, Ctrl+F и т.п.) и свайп-навигация
///   «назад/вперёд»: в приложении одна страница, история WebView не нужна;
/// * статус-бар ссылок и стандартное контекстное меню браузера;
/// * DevTools — только в debug-сборках (команда `open_devtools` и так закрыта
///   `debug_assertions`, здесь закрывается и сам интерфейс F12).
///
/// Настройки применяются через COM-интерфейсы WebView2 (`ICoreWebView2SettingsN`):
/// Tauri не выносит их в `tauri.conf.json`, а интерфейсы добавлялись в SDK
/// постепенно, поэтому каждый блок приводится к своему интерфейсу: на старых
/// средах отсутствующий интерфейс просто пропускается, не роняя запуск.
#[cfg(target_os = "windows")]
fn harden_main_webview(app: &tauri::App) {
    // Интерфейсы WebView2 живут в биндингах webview2-com (их же использует
    // wry/tauri): в crate `windows` расширенных настроек WebView2 нет.
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
        // SAFETY: замыкание выполняется на главном потоке, пока WebView жив;
        // controller/CoreWebView2/Settings возвращают валидные COM-объекты,
        // вызовы только выставляют настройки интерфейса и не освобождают
        // указатели. Приведения к Settings3..6 — проверенные QueryInterface,
        // каждый результат проверяется перед использованием.
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

/// На других платформах WebView-надстройки нет: no-op для единообразия вызова.
#[cfg(not(target_os = "windows"))]
fn harden_main_webview(_app: &tauri::App) {}

/// Иконка окна и кнопки таскбара — из бренд-файла, встроенного в бинарник
/// (`include_bytes!`): runtime-установка не зависит ни от свежести
/// exe-ресурса, ни от кэша иконок Windows, ни от ярлыка, которым запущено
/// приложение. Ошибка здесь не фатальна: останутся ресурсы exe.
fn set_main_window_icon(app: &tauri::App) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        warn!("главное окно не найдено — иконка не установлена");
        return;
    };
    // PNG распаковывается в RGBA на старте: tauri::image::Image принимает
    // только сырые пиксели.
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
