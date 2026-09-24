//! Предпроверка WebView2 Runtime до создания окна Tauri.
//!
//! Без WebView2 интерфейс приложения создать нечем: процесс при этом жив
//! (трей создаётся в `setup`), а окно не появляется вовсе — «трей-зомби».
//! Чтобы диагностировать это на месте, до инициализации Tauri опрашивается
//! реестр (три расположения ключа клиента EdgeUpdate: per-machine,
//! WOW6432Node и per-user), и при отсутствии рантайма показывается
//! нативный MessageBox (GUI рисовать нечем) с предложением открыть
//! официальную страницу загрузки WebView2 Runtime.
//!
//! Установка из приложения намеренно не делается тихой: инсталлятор
//! поставки уже несёт встроенный бутстраппер WebView2
//! (`webviewInstallMode: embedBootstrapper` в `tauri.conf.json`), а ручная
//! установка требует UAC и сети; в закрытых контурах используют offline-
//! installer или fixed-version runtime (папка рядом с exe и переменная
//! `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`).
//!
//! Проверку можно отключить переменной окружения
//! `KMPB_SKIP_WEBVIEW_CHECK=1` (нестандартные окружения, fixed-version).

use windows::core::w;
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
    KEY_READ, RRF_RT_REG_SZ,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONWARNING, MB_YESNO, SW_SHOWNORMAL,
};

/// GUID клиента WebView2 Runtime в ключе EdgeUpdate.
const WEBVIEW2_CLIENTS_SUBKEY: &str =
    r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

/// Читает строковое значение `pv` (версия рантайма) из ключа клиента.
fn read_version(root: HKEY, subkey: &str) -> Option<String> {
    unsafe {
        let mut key = HKEY::default();
        // Явный &HSTRING: без аннотации P1 не выводится (&HSTRING и &BSTR
        // оба реализуют Param<PCWSTR>).
        let subkey = windows::core::HSTRING::from(subkey);
        if RegOpenKeyExW(root, &subkey, None, KEY_READ, &mut key).is_err() {
            return None;
        }
        let value = windows::core::HSTRING::from("pv");
        let mut size = 0u32;
        let probed = RegGetValueW(
            key,
            None,
            &value,
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut size),
        );
        if probed.is_err() || size == 0 {
            let _ = RegCloseKey(key);
            return None;
        }
        let mut buffer: Vec<u16> = vec![0; size as usize / 2 + 1];
        let read = RegGetValueW(
            key,
            None,
            &value,
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        );
        let _ = RegCloseKey(key);
        if read.is_err() {
            return None;
        }
        let len = buffer
            .iter()
            .position(|&ch| ch == 0)
            .unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..len]))
    }
}

/// Установлен ли WebView2 Runtime: версия присутствует и не нулевая
/// (`0.0.0.0` оставляет EdgeUpdate «заглушку» без рантайма).
pub fn webview2_runtime_installed() -> bool {
    let by_registry = [
        read_version(HKEY_LOCAL_MACHINE, WEBVIEW2_CLIENTS_SUBKEY),
        read_version(
            HKEY_LOCAL_MACHINE,
            &format!(r"SOFTWARE\WOW6432Node\{}", WEBVIEW2_CLIENTS_SUBKEY),
        ),
        read_version(HKEY_CURRENT_USER, WEBVIEW2_CLIENTS_SUBKEY),
    ]
    .iter()
    .flatten()
    .any(|version| {
        let trimmed = version.trim();
        !trimmed.is_empty() && trimmed != "0.0.0.0"
    });
    by_registry || runtime_on_disk()
}

/// Фолбэк по файловой системе: в большинстве случаев рантайм приезжает
/// вместе с браузерами (Edge/Chrome) и может быть не виден в ключах
/// EdgeUpdate (per-user установка, fixed-version). Ищем каталог рантайма
/// с `msedgewebview2.exe` в per-machine и per-user расположениях.
fn runtime_on_disk() -> bool {
    ["ProgramFiles(x86)", "ProgramFiles", "LocalAppData"]
        .iter()
        .filter_map(|var| std::env::var(var).ok())
        .map(|base| {
            std::path::Path::new(&base)
                .join("Microsoft")
                .join("EdgeWebView")
                .join("Application")
        })
        .any(|app_dir| {
            // is_ok_and вместо map_or(false, …): clippy style-lint
            // unnecessary_map_or под -D warnings (read_dir даёт Result).
            std::fs::read_dir(&app_dir).is_ok_and(|entries| {
                entries
                    .flatten()
                    .any(|entry| entry.path().join("msedgewebview2.exe").is_file())
            })
        })
}

/// Нативный диалог об отсутствии WebView2 Runtime: GUI рисовать нечем,
/// поэтому MessageBox, а не окно приложения. «Да» — открывает официальную
/// страницу загрузки в браузере по умолчанию.
pub fn report_missing_runtime() {
    unsafe {
        let choice = MessageBoxW(
            None,
            w!("Не найден компонент Microsoft Edge WebView2, необходимый для интерфейса приложения.\n\
                Открыть официальную страницу загрузки WebView2 Runtime? После установки \
                запустите справочник повторно."),
            w!("KMaruda Phonebook"),
            MB_YESNO | MB_ICONWARNING,
        );
        if choice == IDYES {
            // w!-литералы: параметр PCWSTR иначе не выводится типом.
            ShellExecuteW(
                None,
                w!("open"),
                w!("https://developer.microsoft.com/microsoft-edge/webview2/"),
                None,
                None,
                SW_SHOWNORMAL,
            );
        }
    }
}
