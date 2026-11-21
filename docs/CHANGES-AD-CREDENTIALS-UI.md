# AD credentials UI: две правки

База: GitHub `main`, версия **0.2.24**.  
Дата: 20.11.2026.

## 1. Убрано дублирование текста про пароль

**Было:** под переключателем «Current Windows user credentials» показывались
два текста подряд:

- `integratedAuthDesc` — «Kerberos/NTLM ... No password needed.»;
- `integratedAuthHint` — «The app uses the security ticket ... No account or
  password required.»

Оба говорили одно и то же.

**Стало:** остался только `integratedAuthDesc`. Блок с
`integratedAuthHint` удалён из `SettingsAdAuthToggle.tsx`; сам ключ удалён из
`ru.json`/`en.json`, чтобы не висел неиспользуемым.

## 2. Убрана синяя обводка у текстовых полей AD

`TextField` использовал:

```text
border-border focus:border-primary
```

Из-за этого поля **Organization name**, **Server address** и **Base DN** при
фокусе получали синюю рамку, хотя в остальных местах синий focus-ring уже
убран.

**Стало:**

```text
border-border focus:border-foreground/30
```

То есть при фокусе остаётся нейтральная серая рамка, а не синяя. Ошибка
по-прежнему выделяется красным:

```text
border-red-500/60 focus:border-red-500
```

Правка сделана в общем `TextField`, поэтому она действует на все поля этого
компонента: organization, LDAP URL, Base DN, bind DN, пароль и таймауты.

## Изменённые файлы

```text
M src/components/ui/TextField.tsx
M src/features/settings/components/SettingsAdAuthToggle.tsx
M src/locales/ru.json
M src/locales/en.json
```

## Проверки

- `npx tsc --noEmit` — OK;
- `npm run check:locales` — OK;
- `npm run format:check` — OK;
- `npm test` — **101/101**.
