#![cfg(windows)]

//! Native uninstaller for the MSI entry.
//!
//! `UninstallString` points at the application executable itself:
//! `kmaruda-phonebook.exe --uninstall`. The flag is handled before Tauri starts,
//! so no PowerShell/scripts are involved and the dialog is a normal Win32
//! TaskDialog. When the data checkbox is set, user data and Credential Manager
//! entries are removed before `msiexec /x` is launched elevated.

use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use windows::core::{w, BOOL, HSTRING};
use windows::Win32::UI::Controls::{
    TaskDialogIndirect, TASKDIALOGCONFIG, TASKDIALOGCONFIG_0, TASKDIALOG_BUTTON,
    TDF_ALLOW_DIALOG_CANCELLATION, TDF_SIZE_TO_CONTENT, TD_INFORMATION_ICON,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK, SW_SHOWNORMAL};
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const PRODUCT_NAME: &str = "KMAruda PhoneBook";

/// True when the executable was started by the MSI `UninstallString`.
pub fn is_requested() -> bool {
    std::env::args_os().any(|arg| arg == OsStr::new("--uninstall"))
}

/// Show the native uninstall dialog and launch `msiexec /x` when confirmed.
pub fn run() -> ! {
    let Some(product_code) = product_code_arg().or_else(find_product_code) else {
        show_error("Не удалось найти установленный KMAruda PhoneBook.");
        std::process::exit(1);
    };

    let delete_data = match confirm() {
        Ok(Some(checked)) => checked,
        Ok(None) => std::process::exit(0), // cancel/close
        Err(error) => {
            show_error(&format!("Не удалось показать окно удаления: {error}"));
            std::process::exit(1);
        }
    };

    if delete_data {
        if let Err(error) = delete_app_data() {
            show_error(&format!(
                "Не удалось удалить данные приложения:\n{error}\n\nУдаление отменено."
            ));
            std::process::exit(1);
        }
    }

    if let Err(error) = launch_msiexec(&product_code) {
        show_error(&format!("Не удалось запустить удаление:\n{error}"));
        std::process::exit(1);
    }

    // msiexec removes the executable; this process must release it first.
    std::process::exit(0);
}

fn product_code_arg() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let index = args.iter().position(|arg| arg == "--uninstall")?;
    let candidate = args.get(index + 1)?;
    if candidate.starts_with('{') && candidate.ends_with('}') {
        Some(candidate.clone())
    } else {
        None
    }
}

fn find_product_code() -> Option<String> {
    let uninstall = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")
        .ok()?;

    for name in uninstall.enum_keys().flatten() {
        let Ok(key) = uninstall.open_subkey(&name) else {
            continue;
        };
        if key.get_value::<String, _>("DisplayName").ok().as_deref() == Some(PRODUCT_NAME) {
            return Some(name);
        }
    }
    None
}

fn confirm() -> Result<Option<bool>, String> {
    let mut button = 0i32;
    let mut verification = BOOL(0);
    let buttons = [
        TASKDIALOG_BUTTON {
            nButtonID: 1,
            pszButtonText: w!("Удалить"),
        },
        TASKDIALOG_BUTTON {
            nButtonID: 2,
            pszButtonText: w!("Отмена"),
        },
    ];

    // TASKDIALOGCONFIG is packed and has no Default impl.
    let mut config: TASKDIALOGCONFIG = unsafe { std::mem::zeroed() };
    config.cbSize = std::mem::size_of::<TASKDIALOGCONFIG>() as u32;
    config.dwFlags = TDF_ALLOW_DIALOG_CANCELLATION | TDF_SIZE_TO_CONTENT;
    config.pszWindowTitle = w!("KMAruda PhoneBook");
    config.Anonymous1 = TASKDIALOGCONFIG_0 {
        pszMainIcon: TD_INFORMATION_ICON,
    };
    config.pszMainInstruction = w!("Удалить KMAruda PhoneBook?");
    config.pszContent = w!("Программа будет удалена с этого компьютера.");
    config.cButtons = 2;
    config.pButtons = buttons.as_ptr();
    config.nDefaultButton = 1;
    config.pszVerificationText = w!("Удалить данные приложения (настройки, кэш и пароли LDAP)");

    unsafe {
        TaskDialogIndirect(&config, Some(&mut button), None, Some(&mut verification))
            .map_err(|error| error.to_string())?;
    }

    match button {
        1 => Ok(Some(verification.as_bool())),
        2 => Ok(None),
        _ => Ok(None),
    }
}

fn launch_msiexec(product_code: &str) -> Result<(), String> {
    let parameters = HSTRING::from(format!("/x {product_code}"));
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("runas"),
            w!("msiexec.exe"),
            &parameters,
            None,
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        return Err(format!(
            "ShellExecute завершился с кодом {}",
            result.0 as isize
        ));
    }
    Ok(())
}

fn delete_app_data() -> Result<(), String> {
    let mut errors = Vec::new();

    stop_other_instances();

    for path in app_data_paths() {
        remove_dir_with_retries(&path, &mut errors);
    }

    delete_credentials();
    remove_old_launcher();

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

/// Close another running copy of the app before deleting its database/cache.
/// The current process is excluded, otherwise this uninstaller kills itself.
fn stop_other_instances() {
    let current_pid = std::process::id();
    let filter = format!("PID ne {current_pid}");
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "kmaruda-phonebook.exe", "/FI", &filter])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    std::thread::sleep(std::time::Duration::from_millis(700));
}

fn app_data_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for variable in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(root) = std::env::var_os(variable) {
            let root = PathBuf::from(root);
            paths.push(root.join("KMAruda PhoneBook"));
            // Older builds stored data under the reverse-DNS identifier.
            paths.push(root.join("com.kmaruda.phonebook"));
        }
    }
    paths
}

fn remove_dir_with_retries(path: &Path, errors: &mut Vec<String>) {
    if !path.exists() {
        return;
    }
    for _ in 0..3 {
        let _ = std::fs::remove_dir_all(path);
        if !path.exists() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(700));
    }
    if path.exists() {
        errors.push(format!("не удалось удалить {}", path.display()));
    }
}

fn delete_credentials() {
    let mut targets: BTreeSet<String> = BTreeSet::new();
    targets.insert("db-key.kmaruda-phonebook".into());
    targets.insert("db-key-backup.kmaruda-phonebook".into());

    if let Ok(output) = Command::new("cmdkey")
        .arg("/list")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let Some(token) = line.split_whitespace().last() else {
                continue;
            };
            let target = token.rsplit('=').next().unwrap_or(token);
            if target.ends_with(".kmaruda-phonebook") {
                targets.insert(target.to_string());
            }
        }
    }

    for target in targets {
        let _ = Command::new("cmdkey")
            .arg(format!("/delete:{target}"))
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

fn remove_old_launcher() {
    if let Some(program_data) = std::env::var_os("ProgramData") {
        let _ = std::fs::remove_dir_all(PathBuf::from(program_data).join("KMAruda"));
    }
}

fn show_error(message: &str) {
    let text = HSTRING::from(message);
    unsafe {
        MessageBoxW(None, &text, w!("KMAruda PhoneBook"), MB_OK | MB_ICONERROR);
    }
}
