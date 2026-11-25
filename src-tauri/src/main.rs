//! The binary entry point is thin: all logic lives in the `app_lib` library,
//! which allows reusing it for mobile targets and in integration tests.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run();
}
