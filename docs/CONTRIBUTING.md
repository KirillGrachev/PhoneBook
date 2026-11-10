# Contributing to KMAruda Phonebook

Thanks for taking the time to improve the project. This guide covers the local
setup, the architecture boundary and the conventions used in the repository.

## Before you start

- Read [README.md](../README.md) for the product and architecture overview.
- For a security issue, follow [SECURITY.md](SECURITY.md) instead of opening a
  public issue.
- By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Requirements:

- Windows 10/11 x64 (Active Directory features are Windows-first);
- Node.js 20+ and npm;
- Rust stable with the MSVC toolchain;
- Microsoft C++ Build Tools and the Windows SDK;
- Tauri prerequisites: https://v2.tauri.app/start/prerequisites/

```powershell
git clone https://github.com/KirillGrachev/PhoneBook.git
cd PhoneBook
npm install
npm run tauri dev
```

The browser-only preview is useful for UI work:

```powershell
npm run dev
```

Outside Tauri the app switches to demo mode (`MockContactsService` with the
fixtures in `src/services/mockData.ts`), so no AD connection or Windows APIs
are required. Desktop-only sections (external phonebook file, sync status)
are hidden in this mode.

## Project layout

| Path                            | Responsibility                                     |
| ------------------------------- | -------------------------------------------------- |
| `src/features/contacts`         | Phonebook screen: search, results, contact details |
| `src/features/settings`         | Settings hub and its sections (AD, groups, etc.)   |
| `src/components`                | Shared UI: sidebar, modals, header, QR code, splash |
| `src/services`                  | Contact service contract, Tauri and mock backends  |
| `src/store`                     | Zustand store and the persisted-config bridge      |
| `src/api`                       | Typed IPC contracts and error normalization        |
| `src/lib`                       | i18n, motion presets, vCard, search, config exchange |
| `src/locales`                   | Reference (ru) and English dictionaries            |
| `src-tauri/src/commands`        | Typed IPC boundary and input validation            |
| `src-tauri/src/services/ldap`   | Native LDAP client (ldap3), parsing, sync          |
| `src-tauri/src/services/db`     | Encrypted SQLite cache (AES-256-GCM at rest)       |
| `src-tauri/src/services/config` | `config.json` store, validation, keyring secrets   |
| `scripts/`                      | Release and consistency checks                     |

Keep the boundary intact: React talks to Rust only through the typed commands
in `src-tauri/src/commands`, and the Rust side must not know about React.
LDAP bind passwords never leave the keyring: the frontend only sees the
`hasPassword` flag.

## Checks

Run these before opening a pull request:

```powershell
npm run format:check
npm run typecheck
npm run lint
npm test
npm run check:locales
npm run check:version
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

CI runs the same set on Ubuntu and Windows plus `cargo audit`, CodeQL and the
OSV scanner; see [.github/workflows](../.github/workflows).

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:` …).
- UI text lives in `src/locales/ru.json` (reference) and `en.json`. The
  locale check fails on drift, missing plural categories or mismatched
  `{{placeholders}}`.
- Search stays in the backend: React only sends `SearchParams` over IPC and
  renders the page it receives. Do not reintroduce client-side filtering of
  the full directory.
- The `Анимации` toggle must keep working: animation presets degrade to zero
  duration through the root `MotionConfig`, and CSS animations are disabled
  by the `.disable-animations` class.
- Version is kept in sync across `package.json`, `src-tauri/tauri.conf.json`
  and `src-tauri/Cargo.toml`; `scripts/check-version.mjs` enforces it.

## Releases

1. Bump the version in the three files above.
2. Merge to `main`, then push a tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The Release workflow builds the MSI/NSIS installers and attaches them to a
   draft GitHub Release.
