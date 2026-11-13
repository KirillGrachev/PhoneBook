# PhoneBook fuzz targets

Requires `cargo-fuzz` and a nightly toolchain:

```powershell
cargo install cargo-fuzz
cd src-tauri
cargo +nightly fuzz run phonebook_xml
```

The target feeds arbitrary UTF-8 into the Yealink IPPhoneBook XML parser and
treats any panic as a failure. It is intentionally outside the normal Cargo
test run; the parser is also covered by the `proptest` regression test.
