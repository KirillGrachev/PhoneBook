# KMAruda PhoneBook

A Windows-first corporate phone book backed by Active Directory: fast search,
employee profiles, contact photos, QR vCards and vCard export. Built with Tauri
2, React/TypeScript and an encrypted local SQLite cache.

- [Documentation](docs/README.md) — features, stack, setup and checks
- [Deployment](docs/DEPLOYMENT.md) — embedded managed configuration
- [Latest release](https://github.com/KirillGrachev/PhoneBook/releases/latest)
- [Changelog](CHANGELOG.md)

## Quick start

Requirements: Windows 10/11 x64, Node.js 22+, Rust stable (MSRV 1.89), MSVC
Build Tools and the Windows SDK.

```powershell
npm install
npm run tauri dev
```

Browser demo mode, without Tauri or Active Directory:

```powershell
npm run dev
```

MIT licensed — see [LICENSE](LICENSE).
