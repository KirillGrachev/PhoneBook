# Changelog

All notable changes to KMAruda PhoneBook are documented here. The project
follows [Semantic Versioning](https://semver.org/).

## [0.2.21] - 2026-11-17

### Fixed

- Programs and Features now honors the custom uninstall launcher: after MSI
  registration the installer sets the ARP `WindowsInstaller` value to `0`, so
  Windows runs the PowerShell launcher instead of invoking `msiexec /x`
  directly. The launcher is where the "Delete application data" checkbox lives.
- The launcher remains best-effort: if the registry rewrite fails, installation
  still succeeds and the standard MSI uninstall remains available.

## [0.2.20] - 2026-11-17

### Fixed

- The MSI now registers its uninstall launcher from a deferred action running
  elevated before `InstallFinalize`, instead of an immediate action after it.
  This makes the Apps & Features `UninstallString` reliably point to the
  launcher that shows the "Delete application data" checkbox.
- The uninstaller checkbox wording and release notes now explicitly document
  that checked removes settings, cache, LDAP passwords and both the new and
  legacy data directories; unchecked preserves them.

## [0.2.19] - 2026-11-17

### Changed

- Application data now lives in `%APPDATA%\KMAruda PhoneBook` and local data in
  `%LOCALAPPDATA%\KMAruda PhoneBook` instead of the reverse-DNS identifier
  directory `com.kmaruda.phonebook`.
- The previous `%APPDATA%\com.kmaruda.phonebook` directory is migrated to the
  new location on first launch, so configuration, cache and the database key
  file are preserved.
- The uninstall data cleanup removes both the new and the legacy directories.

## [0.2.18] - 2026-11-17

### Changed

- Windows publisher/manufacturer is now **KirillGrachev** instead of `kmaruda`,
  so Apps & Features, the MSI `Manufacturer` property and the NSIS uninstall
  entry show the correct publisher.

## [0.2.17] - 2026-11-17

### Fixed

- The MSI no longer reports "A program run as part of the setup did not finish
  as expected" after a successful install when the best-effort `UninstallString`
  rewrite fails. The rewrite is now non-fatal, so the installer returns success
  and the application remains registered.

## [0.2.16] - 2026-11-17

### Changed

- The MSI package is now built with `ru-RU` WiX language, so the installer UI
  matches the Russian product and the asset is named `_x64_ru-RU.msi` instead of
  `_x64_en-US.msi`.

## [0.2.15] - 2026-11-17

### Added

- The MSI uninstaller now offers a "Delete application data" checkbox. The
  checkbox lives in an uninstall launcher installed by the MSI and registered
  as `UninstallString`, because `msiexec /x` does not show the WiX package UI.
  When checked, a deferred action removes the configuration, encrypted cache,
  WebView2 data and the application's Windows Credential Manager entries;
  unchecked preserves them.

### Removed

- The organization-group "enterprise group" pin action was removed. The
  KMAruda tab now always uses the first configured AD organization.

### Fixed

- The encrypted-cache key now also has a DPAPI-protected copy in
  `phonebook.key` next to the database. If Windows Credential Manager loses
  either or both `db-key` entries, the app recovers the key from this file
  instead of minting a new one and quarantining the cache. A transient keyring
  error no longer generates a fresh key while the database exists.
- The organization-group card icon is now optically centered on the group name.
- In test mode the directory no longer leaks real AD configuration into the
  organization filter or enterprise tab, including when real LDAP connections
  and groups are still present in the store.
- The LDAP connection/operation timeout number fields now center their values
  and no longer show the native up/down spin buttons.
- The external phonebook auto-refresh dropdown now always opens below its
  trigger instead of flipping above and covering the description; its width
  was widened so interval labels are not truncated.
- The MSI now carries the KMARuda artwork: the WiX dialog panel reuses the
  NSIS sidebar image without covering page content, and the top banner uses the
  plain application icon.

## [0.2.14] - 2026-11-16

### Fixed

- Organization-group entries in the directory filter now use the same `Groups`
  layers icon as the organization-group settings, instead of the temporary
  folder emoji.

## [0.2.13] - 2026-11-16

### Fixed

- The encrypted cache key now has a redundant Credential Manager entry
  (`db-key-backup`). If the primary entry disappears or becomes unreadable, the
  app recovers the key instead of minting a new one and losing the cache.
- If the key still does not match, the encrypted container is quarantined as
  `phonebook.db.unreadable-<timestamp>` instead of being deleted, so a later key
  recovery is possible. The app starts with a fresh cache and re-syncs.

## [0.2.12] - 2026-11-16

### Fixed

- Editing an organization group now opens its editor directly below the group
  card, scrolls it into view and focuses the name field. Previously the editor
  appeared after the whole list with no indication of where it opened.

## [0.2.11] - 2026-11-16

### Added

- Per-file auto-refresh interval for external Yealink XML phone books. Each
  selected file can be set to manual only, 1, 6, 12, 24, 72 or 168 hours. The
  scheduler re-reads the selected files as one atomic batch when any configured
  interval is due, so a file is never older than its interval.

## [0.2.10] - 2026-11-16

### Fixed

- Search by an e-mail local part without `@` now works: `grachev_ke` finds
  `Grachev_ke@metholding.com`. FTS query building treats `_`, `.`, `-` and `+`
  as separators for every word, not only for complete addresses.

## [0.2.9] - 2026-11-16

### Fixed

- Long Active Directory authentication/synchronization errors now wrap inside
  the AD settings card instead of being rendered as one line that runs off the
  window. Toast titles and descriptions are also capped to the viewport and
  wrap long LDAP details.

## [0.2.8] - 2026-11-16

### Fixed

- Removed the custom MSI banner and dialog images. In the WiX layout they
  overlapped the "Destination Folder" text; the MSI now uses the default WiX
  page layout again. The NSIS EXE keeps its existing header/sidebar artwork.

## [0.2.7] - 2026-11-14

### Changed

- MSI installer now uses the same KMARUDA banner and dialog artwork as the
  NSIS EXE installer.

## [0.2.6] - 2026-11-14

### Added

- Multiple external Yealink IPPhoneBook (XML) sources. Each file is imported
  as its own directory source.
- Cached fallback when an external source file is missing or unreadable: the
  encrypted directory cache is kept and a warning is shown instead of a sync
  error.
- Montserrat as the application font, with local 400/500/600/700 weights.
- Configurable LDAP connection and operation timeouts (1–300 seconds) in AD
  settings.
- Transient LDAP resets/timeouts are retried twice with exponential backoff.
- LDAP fetch logs include page count, elapsed time and retry context.
- Property test: the Yealink XML parser never panics on arbitrary input.
- LDAP controller failover: multiple comma/semicolon-separated URLs are tried in order.
- Playwright visual-regression baseline for the main light-theme window.
- SQLite schema self-heal now also detects missing contact columns such as
  `pager`, so an old cache no longer requires manual deletion.
- The contact card closes when a search/filter returns no matches, and changing
  the tab or organization filter resets the previous selection.
- Job title, department and organization are shown on separate lines in the
  contact header instead of a dot-separated sentence.
- English locale transliterates person names according to the company table;
  QR/vCard uses the same English name.
- Contact-info separators now run across the full card width.

### Changed

- New 34-icon set with currentColor masks; contact card, settings, external
  files, groups and modals now use the new visual language.
- Tauri 2.12.5, webview2-com 0.39.1 and windows 0.62.2.
- Montserrat is now used by both the sans and mono theme tokens, so the
  root `font-sans` class no longer falls back to the system font.
- The visual-regression baseline now reflects the new icon set and font.
- Removed the lucide-react dependency; control icons (check, chevrons, close,
  spinner, window controls) are inline SVG now.
- Removed the unused `base64` Rust dependency.
- Rust coverage runs on Ubuntu in Nightly with a 65% line / 58% function
  floor and uploads the lcov artifact.
- Header search/help icons are 24 px and the settings gear is 22 px, matching
  the filter control.
- SettingsGroupsView is split into OrgGroupCard and OrgGroupEditor components.
- ContactDetails is split into ContactInfoCard and CompanyInfoCard components.
- SettingsAdView is split into SettingsAdSyncCard and SettingsAdDuplicates.
- CI checks parity between the Rust DTOs and their TypeScript mirrors.
- libFuzzer target for the Yealink XML parser (`src-tauri/fuzz`).
- Nightly Windows builds the native executable, checks that it stays alive for
  8 seconds, has a visible window, and exposes the expected title.
- English backend-error catalog covers every exposed code; a test rejects
  Cyrillic fallbacks in the English UI.
- Fuzz seed corpus for valid, truncated and edge-case Yealink XML.
- Local native UI E2E via WebView2 CDP (`npm run test:native`); CI keeps the
  native build/launch/window/title smoke because WebView2 remote debugging is
  not available on the hosted Windows runner.
- Manual Release dry run workflow builds MSI/NSIS, verifies them, creates the
  portable ZIP and SHA256SUMS without publishing a release.
- Manual Linux Fuzz workflow runs the Yealink XML target for 60 seconds with
  the seed corpus on the GNU target (no static-libc ASan conflict).
- XML parser extracted into the `phonebook-xml` crate; the fuzzer no longer
  links Tauri/SQLite, runs on Windows too, and the fuzz lock no longer pulls the
  vulnerable `glib` version (Dependabot alert 19).
- Ten core DTO interfaces are generated from the Rust serde structs; CI rejects
  a stale generated TypeScript contract.

## [0.2.5] - 2026-11-12

### Added

- Multi-file external phone book selection, per-file sources, add/remove
  actions and atomic refresh.
- Legacy single-path configuration migration.

## [0.2.4] - 2026-11-12

### Fixed

- LDAP driver task is stopped with its session; late `socket shutdown error`
  warnings after a successful sync are gone.

## [0.2.3] - 2026-11-12

### Fixed

- Help icon centering, organization filter size, Save Contact person-plus
  icon, classic phone watermark and QR `text-scan` overlay.
- Theme icon/label vertical alignment.

## [0.2.2] - 2026-11-12

### Added

- English is the default interface language; existing installations migrate
  from the old Russian default unless the language was explicitly chosen.
- README light/dark screenshots captured from the live app.

## [0.2.1] - 2026-11-12

### Added

- New KMAruda SVG icon set rendered through `currentColor` masks.

## [0.2.0] - 2026-11-11

### Added

- First public release: Active Directory phone book, encrypted SQLite cache,
  FTS5/trigram search, QR vCard, favorites, organization groups, external
  Yealink XML import and MSI/NSIS installers.

[Unreleased]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.21...HEAD
[0.2.21]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.20...v0.2.21
[0.2.20]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.19...v0.2.20
[0.2.19]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.18...v0.2.19
[0.2.18]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.17...v0.2.18
[0.2.17]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.16...v0.2.17
[0.2.16]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.15...v0.2.16
[0.2.15]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.14...v0.2.15
[0.2.14]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.13...v0.2.14
[0.2.13]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.12...v0.2.13
[0.2.12]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.11...v0.2.12
[0.2.11]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/KirillGrachev/PhoneBook/releases/tag/v0.2.0
