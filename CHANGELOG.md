# Changelog

All notable changes to KMAruda PhoneBook are documented here. The project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.5...HEAD
[0.2.5]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/KirillGrachev/PhoneBook/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/KirillGrachev/PhoneBook/releases/tag/v0.2.0
