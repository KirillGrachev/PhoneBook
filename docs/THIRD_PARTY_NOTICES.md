# Third-party notices

KMAruda PhoneBook is MIT licensed. The following third-party components are
included or required at runtime.

## Application framework

- **Tauri** and its plugins (`window-state`, `global-shortcut`,
  `single-instance`, `dialog`) are distributed under the Apache-2.0 / MIT
  licenses.
- **React**, **React DOM**, **TanStack Query/Virtual**, **Zustand**,
  **i18next**, **Radix UI**, **lucide-react**, **motion**, **sonner** and
  **react-qr-code** are distributed under the MIT license.
- **Vite**, **TypeScript**, **Vitest**, **ESLint** and **Prettier** are
  development dependencies with their own licenses.

## Rust runtime components

- **rusqlite** with the bundled **SQLite** engine (public domain / MIT).
- **ldap3** — native LDAP client (Apache-2.0 / MIT).
- **aes-gcm** — AES-256-GCM encryption of the local cache at rest
  (Apache-2.0 / MIT).
- **keyring** — OS secret storage (Windows Credential Manager, macOS
  Keychain, Linux keyutils) (Apache-2.0 / MIT).
- **quick-xml** — streaming parser for the external Yealink XML phonebook
  (MIT).
- Full dependency lists with versions and licenses: `src-tauri/Cargo.lock`.

## Microsoft runtime

The app uses the **Microsoft Edge WebView2 Runtime**. Use of the WebView2
Runtime is governed by Microsoft's terms:
https://developer.microsoft.com/microsoft-edge/webview2/

The app links the Microsoft Visual C++ runtime statically through the MSVC
toolchain. No Microsoft binaries are committed to this repository.

## Assets

The KMAruda logo and UI icons are project assets. Do not redistribute them
as part of another product without permission.
