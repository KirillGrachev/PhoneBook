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
