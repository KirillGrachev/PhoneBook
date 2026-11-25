fn main() {
    // The icons are compiled into the exe resource (tauri-winres) and into the binary
    // (tauri::generate_context!: the window and tray icon), but neither tauri-build nor
    // macro does not track icon files. Explicitly declare the dependency
    // of the build script from every file: replacing the logo is guaranteed
    // rebuilds the window, tray, and installer resources.
    for icon in [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.png",
        "icons/icon.ico",
    ] {
        println!("cargo:rerun-if-changed={icon}");
    }

    // Managed rollout profile: validate and copy the exported config into
    // OUT_DIR so embedded.rs can include_str! it. Without the feature the
    // environment variable is deliberately ignored.
    println!("cargo:rerun-if-env-changed=KMPB_EMBED_CONFIG");
    if std::env::var_os("CARGO_FEATURE_EMBEDDED_CONFIG").is_some() {
        let profile_path = std::env::var_os("KMPB_EMBED_CONFIG").unwrap_or_else(|| {
            panic!(
                "KMPB_EMBED_CONFIG must point to a kmaruda-config.json when building with --features embedded-config"
            )
        });
        let profile_path = std::path::PathBuf::from(profile_path);
        println!("cargo:rerun-if-changed={}", profile_path.display());
        let json = std::fs::read_to_string(&profile_path).unwrap_or_else(|error| {
            panic!(
                "KMPB_EMBED_CONFIG: cannot read {}: {error}",
                profile_path.display()
            )
        });
        let value: serde_json::Value =
            serde_json::from_str(&json).expect("KMPB_EMBED_CONFIG: invalid JSON");
        assert_eq!(
            value["format"], "kmaruda-phonebook/config",
            "KMPB_EMBED_CONFIG: expected a KMAruda PhoneBook config export"
        );
        let out =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR is set by Cargo"))
                .join("embedded-config.json");
        std::fs::write(out, json).expect("KMPB_EMBED_CONFIG: cannot write embedded profile");
    }

    tauri_build::build()
}
