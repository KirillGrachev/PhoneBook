//! Точка входа бинарника тонкая: вся логика живёт в библиотеке `app_lib`,
//! что позволяет переиспользовать её на мобильных целях и в интеграционных тестах.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run();
}
