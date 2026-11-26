pub mod base64;
pub mod config;
pub mod db;
pub mod external;
pub mod ldap;
pub mod policy;
pub mod records;
pub mod sync;
pub mod tokens;
pub mod vcard;

/// WebView2 Runtime pre-check (Windows only): a native dialog instead of
/// "tray zombie", when there is nothing to create the UI with.
#[cfg(target_os = "windows")]
pub mod webview_prereq;
