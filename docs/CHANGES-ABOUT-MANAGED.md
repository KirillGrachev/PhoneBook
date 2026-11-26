# About: managed banner и профиль конфигурации

> Историческая заметка для workspace 0.2.24. Актуальное поведение описано в README.md, DEPLOYMENT.md и CHANGELOG.md.

База: GitHub `main`, версия **0.2.24**.  
Дата: 20.11.2026.

## Изменения

1. **Баннер «Управляется вашей организацией» больше не показывается на
   экране «О программе».**
   Баннер остаётся в остальных разделах настроек; условие в `SettingsPage.tsx`
   теперь `managed && view !== 'about'`.

2. **Профиль конфигурации убран с экрана «О программе».**
   Остался обычный вертикальный блок версии:

   ```text
   VERSION
   0.2.24
   ```

3. **Ревизия профиля больше не выводится.**
   Удалён `managedRevision` из `SettingsAboutView` и ключ
   `managed.revision` из `ru.json`/`en.json`. Ключ `managed.profile` также
   удалён, потому что больше нигде не используется.

## Файлы

```text
M src/features/settings/SettingsPage.tsx
M src/features/settings/components/SettingsAboutView.tsx
M src/locales/ru.json
M src/locales/en.json
M CHANGELOG.md
```

## Проверки

- `npx tsc --noEmit` — OK;
- `npm run check:locales` — OK (273 ключа);
- `prettier --check` — OK;
- `npm test` — **101/101**.
