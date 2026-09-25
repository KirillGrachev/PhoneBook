pub mod config;
pub mod db;
pub mod external;
pub mod ldap;
pub mod policy;
pub mod records;
pub mod sync;
pub mod tokens;
pub mod vcard;

/// Предпроверка WebView2 Runtime (только Windows): нативный диалог вместо
/// «трей-зомби», когда интерфейс создать нечем.
#[cfg(target_os = "windows")]
pub mod webview_prereq;
