# Embedded profile: скрытие административных настроек

> Историческая заметка для workspace 0.2.24. Актуальное поведение описано в README.md, DEPLOYMENT.md и CHANGELOG.md.

База: GitHub `main`, версия **0.2.24**.  
Дата: 20.11.2026.

## Поведение

При `managed = true` (embedded config) в настройках остаются только:

- **Интерфейс и поиск**;
- **О программе**.

Скрыты:

- внешний телефонный файл;
- перенос конфигурации;
- Active Directory;
- группы организаций.

Прямые ссылки вида `?view=ad` / `?view=groups` / `?view=external` /
`?view=transfer` перенаправляют на главный экран настроек.

## Hover

- Строки навигации по настройкам сохраняют обычную hover-подсветку.
- Без hover остаются только кнопки **внутри** заблокированных разделов,
  если они ещё отрисованы до перехода/в переходный момент.
- Локальные настройки (тема, язык, анимации) остаются интерактивными.

## Файлы

```text
M src/features/settings/components/SettingsMainView.tsx
M src/features/settings/SettingsPage.tsx
M src/features/settings/__tests__/SettingsPage.test.tsx
M src/locales/ru.json
M src/locales/en.json
M CHANGELOG.md
```

## Проверки

- тест managed-профиля проверяет, что пункты Configuration transfer,
  Active Directory Settings и Organization groups отсутствуют;
- `npm test` — 102/102;
- `tsc`, `check:locales`, Prettier — OK.
