# Security Policy

KMAruda Phonebook binds to Active Directory with a service account, caches
directory data (names, phone numbers, e-mail addresses, departments) on the
local disk and opens external links. Treat LDAP attributes, XML phonebook
content, imported configuration files and every IPC payload as untrusted input.

## Supported versions

| Version              | Supported |
| -------------------- | --------- |
| `main` (development) | Yes       |
| Latest release       | Yes       |
| Older releases       | No        |

Security fixes land on `main` and in the next release. If you are unsure whether
a version is affected, include the commit or release tag in the report.

## Reporting a vulnerability

Do not open a public issue containing a working exploit, credentials, domain
names, employee data or personal paths.

Use GitHub's private vulnerability reporting on the repository:

https://github.com/KirillGrachev/PhoneBook/security/advisories/new

If private reporting is unavailable, contact the maintainer through the GitHub
profile linked in the repository and ask for a private transfer method before
sharing sensitive details.

Please include:

- affected version, commit or installer;
- Windows version and architecture;
- the component involved: UI, Tauri command, LDAP client, local cache,
  encryption layer, external phonebook loader, configuration exchange,
  vCard/QR generation, URL opener or installer;
- impact and the attacker access required (anonymous, authenticated AD user,
  local user, administrator);
- exact reproduction steps;
- expected and actual behavior;
- logs with credentials, employee names and personal paths removed;
- whether the issue reproduces from a clean checkout.

## Scope

Reports are welcome for:

- injection through directory data: LDAP filters, SQL against the local cache,
  vCard or XML content;
- path traversal or symlink handling when reading the external phonebook file or
  writing exchange files, vCards and the cache;
- leakage of the cache encryption key or of LDAP bind credentials into
  `config.json`, logs, crash dumps, IPC payloads or exported files;
- bypass of the external URL allowlist or of the process launcher;
- WebView2, Tauri capability or CSP misconfiguration that lets remote or local
  content reach IPC commands;
- unsafe deserialization of persisted configuration or exchange files;
- denial of service through oversized LDAP responses, XML files or search
  queries;
- dependency or release artifact integrity.

General bugs without a security impact belong in the normal issue tracker.

## Current hardening

- **SQL.** Every value reaches SQLite through a bound parameter. The only
  interpolated fragments are compile-time constants (column lists, joins,
  ordering) and generated `?` placeholders.
- **LDAP.** The user search filter is a compile-time constant
  (`USER_FILTER`); no user input is concatenated into a filter. Base DN and
  server URL are validated and trimmed before the bind.
- **External links.** `open_external` accepts only `http`, `https`, `mailto`,
  `tel`, `callto` and `trueconf`, rejects control characters, whitespace and
  quotes, caps the length at 2048 bytes and launches the OS handler directly —
  never through a command shell.
- **Cache at rest.** The working database lives in memory; the disk holds only
  the `KMPBENC1` container (magic + 12-byte nonce + AES-256-GCM ciphertext of
  the serialized SQLite image). The 32-byte key comes from the CSPRNG and is
  stored in the OS secret store (Windows Credential Manager, macOS Keychain,
  Linux keyutils). Writes go through a temp file plus rename, and a file that is
  foreign, truncated or undecryptable is zero-overwritten and recreated.
- **Secrets.** LDAP bind passwords live only in the OS secret store. They never
  reach `config.json`, the Zustand store, logs or IPC responses; the exported
  configuration resets `hasPassword`.
- **Imported files.** Configuration and organization-group exchange files are
  parsed and validated in Rust (format marker, version, allowed values) before
  the frontend applies them.
- **External phonebook XML.** Parsed in a single streaming pass with
  `quick-xml`: no DOM, no external entity resolution, an 8 MiB size cap and a
  hard failure on malformed input.
- **WebView.** Restrictive CSP (no `unsafe-eval`, `object-src 'none'`,
  `form-action 'none'`), DevTools disabled in release builds, and browser
  behaviors turned off through the WebView2 COM settings: accelerator keys,
  zoom, pinch zoom, swipe navigation, status bar, default context menus,
  autofill and password saving.
- **Capabilities.** The webview holds `core:default` plus window control
  permissions only. No filesystem, shell, HTTP or dialog plugin permission is
  exposed to JavaScript — all privileged operations go through typed Rust
  commands with validated inputs.
- **Responsiveness.** IPC commands touching SQLite, `config.json` or the keyring
  are async and run in the blocking pool, so a background sync transaction
  cannot freeze the window event loop.
- **Release profile.** `panic = "abort"`, LTO, `codegen-units = 1` and stripped
  symbols.

## Dependency assurance

- Dependabot tracks npm, Cargo and GitHub Actions updates.
- CI runs `npm audit --omit=dev --audit-level=high` and `cargo audit`.
- CodeQL analyzes JavaScript/TypeScript and the workflow files on every push,
  pull request and weekly schedule.
- OSV Scanner uploads SARIF results for both lockfiles weekly.
- Pull requests get an automatic dependency review that fails on high severity.

## At-rest data limits

The OS secret store protects the cache key against other accounts, other
machines and offline disk images. It does not protect against code already
running as the same logged-in Windows user, because that user is allowed to read
their own credentials. The app does not claim protection against a compromised
user session.

The cache is a rebuildable mirror of Active Directory: losing it costs one
synchronization, not data. Favorites, organization groups and settings live in
`config.json` in the app configuration directory.

The browser-only preview (`npm run dev` outside Tauri) has no directory access;
it uses mock data and `localStorage`. The desktop build does not use
`localStorage` for configuration.

## Disclosure

Please give the maintainers reasonable time to investigate and ship a fix before
publishing details. Credit is given in the release notes when requested.
