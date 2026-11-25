//! WebView2 Runtime pre-check before creating the Tauri window.
//!
//! Without WebView2 there is no way to create the application UI: the process stays alive
//! (the tray is created in `setup`), and the window never appears - a "tray zombie".
//! To diagnose this on site, before Tauri initialization we query
//! registry (three EdgeUpdate client key locations: per-machine,
//! WOW6432Node and per-user), and if the runtime is absent, a prompt is shown
//! native MessageBox (there is nothing to draw a GUI with) offering to open
//! official WebView2 Runtime download page.
//!
//! In-app installation is intentionally not silent: the installer
//! delivery already carries the embedded WebView2 bootstrapper
//! (`webviewInstallMode: embedBootstrapper` in `tauri.conf.json`), while manual
//! installation requires UAC and network; closed environments use the offline
//! installer or fixed-version runtime (folder next to the exe and the variable
//! `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`).
//!
//! The check can be disabled with the environment variable
//! `KMPB_SKIP_WEBVIEW_CHECK=1` (non-standard environments, fixed-version).

use windows::core::w;
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
    KEY_READ, RRF_RT_REG_SZ,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONWARNING, MB_YESNO, SW_SHOWNORMAL,
};

/// WebView2 Runtime client GUID in the EdgeUpdate key.
const WEBVIEW2_CLIENTS_SUBKEY: &str =
    r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

/// Reads the string value `pv` (runtime version) from the client key.
fn read_version(root: HKEY, subkey: &str) -> Option<String> {
    unsafe {
        let mut key = HKEY::default();
        // Explicit &HSTRING: without the annotation P1 is not inferred (&HSTRING and &BSTR
        // both implement Param<PCWSTR>).
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

/// Whether WebView2 Runtime is installed: the version is present and non-zero
/// (`0.0.0.0` leaves the EdgeUpdate "stub" without a runtime).
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

/// Filesystem fallback: in most cases the runtime arrives
/// together with browsers (Edge/Chrome) and may not be visible in the keys
/// EdgeUpdate (per-user installation, fixed-version). Look for the runtime directory
/// with `msedgewebview2.exe` in per-machine and per-user locations.
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
            // is_ok_and instead of map_or(false, …): the clippy style-lint
            // unnecessary_map_or under -D warnings (read_dir gives a Result).
            std::fs::read_dir(&app_dir).is_ok_and(|entries| {
                entries
                    .flatten()
                    .any(|entry| entry.path().join("msedgewebview2.exe").is_file())
            })
        })
}

/// Native dialog about the missing WebView2 Runtime: there is nothing to draw a GUI with,
/// hence a MessageBox, not the application window. "Yes" opens the official
/// download page in the default browser.
pub fn report_missing_runtime() {
    unsafe {
        let choice = MessageBoxW(
            None,
            w!("Не найден компонент Microsoft Edge WebView2, необходимый для интерфейса приложения.\n\
                Открыть официальную страницу загрузки WebView2 Runtime? После установки \
                запустите справочник повторно."),
            w!("KMAruda PhoneBook"),
            MB_YESNO | MB_ICONWARNING,
        );
        if choice == IDYES {
            // w! literals: otherwise the PCWSTR parameter is not inferred by type.
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
