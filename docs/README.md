<p align="center">
  <img src="../public/logo.png" width="96" height="96" alt="KMAruda PhoneBook logo">
</p>

<h1 align="center">KMAruda PhoneBook</h1>

<p align="center">
  <b>Корпоративный телефонный справочник на базе Active Directory.</b><br>
  Быстрый поиск по ФИО, подразделению, должности, кабинету, телефону и e-mail,
  карточка сотрудника, QR-визитка и выгрузка в vCard.
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="screenshots/home-dark.png">
    <img src="screenshots/home-light.png" alt="KMAruda PhoneBook: карточка сотрудника, контактные данные, QR-визитка и список контактов" width="100%">
  </picture>
  <br>
  <sub>Поиск, карточка сотрудника и QR-визитка в одном окне.</sub>
</p>

Приложение — **Windows-first desktop** на Tauri 2: React/TypeScript-интерфейс,
Rust-бэкенд, локальный зашифрованный кэш SQLite. В браузере доступен
демо-режим с мок-данными.

## Возможности

- поиск по префиксу и подстроке (FTS5 + триграммы), с учётом раскладки
  клавиатуры и форматирования телефонов;
- поиск по e-mail и телефонным «хвостам»;
- синхронизация нескольких подключений AD, внешний XML-файл Yealink;
- карточка сотрудника, руководитель, коллеги по отделу/должности/кабинету;
- избранное, глобальный режим холдинга, группы организаций;
- локальный кэш шифруется AES-256-GCM, пароли AD — в системном keyring;
- интерфейс RU/EN, светлая/тёмная/системная тема, настройка анимаций.

## Стек

- **Frontend:** React 19, TypeScript, Vite 8, TanStack Query/Virtual,
  Zustand, Tailwind CSS 4, Motion.
- **Backend:** Rust, Tauri 2, rusqlite (FTS5, trigram), ldap3, AES-GCM,
  keyring.
- **Tests/CI:** Vitest, Rust unit tests, GitHub Actions (clippy, fmt, cargo
  audit, CodeQL, dependency review, OSV).

## Быстрый старт

Требования: Windows 10/11 x64, Node.js 20+, Rust stable (MSRV 1.89), MSVC
Build Tools и Windows SDK, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
npm install
npm run tauri dev
```

Браузерный демо-режим:

```powershell
npm run dev
```

## Проверки

```powershell
npm run format:check
npm run typecheck
npm run lint
npm test
npm run check:locales
npm run check:version
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Нагрузочный тест поиска (не входит в обычный `cargo test`):

```powershell
cargo test --release --manifest-path src-tauri/Cargo.toml search_load_benchmark -- --ignored --nocapture
```

## Структура

| Путь | Назначение |
| --- | --- |
| `src/features/contacts` | Экран справочника, поиск, карточка |
| `src/features/settings` | Настройки AD, интерфейса, групп, импорта/экспорта |
| `src/services` | Контракт источников, Tauri и demo-реализации |
| `src-tauri/src/commands` | Типизированная IPC-граница |
| `src-tauri/src/services/ldap` | LDAP/AD-клиент и разбор записей |
| `src-tauri/src/services/db` | SQLite-кэш, FTS/триграммы, шифрование |
| `docs` | Contributing, security policy, code of conduct |

## Документация

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Лицензия

MIT — см. [LICENSE](../LICENSE).
