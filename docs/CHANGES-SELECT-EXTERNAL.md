# Select и описание внешних телефонных файлов

> Историческая заметка для workspace 0.2.24. Актуальное поведение описано в README.md, DEPLOYMENT.md и CHANGELOG.md.

База: GitHub `main`, версия **0.2.24**.  
Дата: 20.11.2026.

## 1. Центрирование trigger в выпадающем списке

`Select` теперь использует:

```text
inline-flex h-[34px] items-center justify-between gap-2 px-3 py-0 leading-none
```

- надпись и шеврон выровнены по центру поля;
- у шеврона `shrink-0 self-center`;
- `leading-none` убран лишний line-height, из-за которого текст казался
  смещённым;
- при открытии шеврон по-прежнему поворачивается на 180° вокруг центра.

Правка общая, поэтому действует и на автообновление во внешних телефонных
файлах (`SettingsExternalView`).

## 2. Большой текст разбит на абзацы

`settings.externalDesc` теперь содержит `\n\n` между смысловыми частями:

1. что такое выгрузки Yealink и как они попадают в справочник;
2. что делает тумблер включения;
3. что делает «Загрузить сейчас» и как работает автообновление.

`SettingsExternalView` режет строку по пустым строкам и рисует отдельные
`<p>` с отступом `gap-1.5`, а не один сплошной абзац.

## Файлы

```text
M src/components/ui/Select.tsx
M src/features/settings/components/SettingsExternalView.tsx
M src/locales/ru.json
M src/locales/en.json
M CHANGELOG.md
```

## Проверки

- `npm test` — **102/102**;
- `npx tsc --noEmit` — OK;
- `npm run check:locales` — OK;
- Prettier — OK.
