# Стартовый экран: без полной выдачи

> Историческая заметка для workspace 0.2.24. Актуальное поведение описано в README.md, DEPLOYMENT.md и CHANGELOG.md.

База: GitHub `main`, версия **0.2.24**.  
Дата: 20.11.2026.

## Поведение

При входе в справочник список пуст: пользователь сразу видит подсказку
«Начните поиск», а не весь каталог.

Запрос контактов уходит только если:

- строка поиска непустая;
- или явно выбрана организация / группа фильтра;
- или открыта вкладка «Мои контакты» (там набор уже ограничен избранным).

При очистке поиска и снятии фильтра список снова становится пустым, старая
выдача не остаётся.

## Файлы

```text
M src/features/contacts/hooks/useContactsList.ts
M src/features/contacts/PhonebookView.tsx
M src/locales/ru.json
M src/locales/en.json
M src/features/contacts/hooks/__tests__/useContactsList.test.tsx
M CHANGELOG.md
```

## Проверки

- новый тест: без запроса и без фильтра `contacts=[]`, `total=0`;
- `npm test` — **103/103**;
- `tsc`, `check:locales`, Prettier — OK.
