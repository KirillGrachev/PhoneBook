fn main() {
    // Иконки вкомпиливаются в exe-ресурс (tauri-winres) и в бинарник
    // (tauri::generate_context!: иконка окна и трея), но ни tauri-build, ни
    // макрос не следят за файлами иконок. Явно объявляем зависимость
    // build-скрипта от каждого файла: замена логотипа гарантированно
    // пересобирает ресурсы окна, трея и установщика.
    for icon in [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.png",
        "icons/icon.ico",
    ] {
        println!("cargo:rerun-if-changed={icon}");
    }
    tauri_build::build()
}
