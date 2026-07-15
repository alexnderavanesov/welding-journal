# Welding Tracker

Локальное веб-приложение для учета сварочных стыков трубопроводов.

## Стек

- TanStack Start + TypeScript
- TanStack Query
- PostgreSQL 18 через Docker Compose
- Drizzle ORM
- Tailwind CSS + shadcn/ui-style components
- Vitest

## Запуск

```bash
corepack enable
pnpm install
pnpm db:up
pnpm db:migrate
pnpm dev
```

Откройте `http://localhost:3000`.

Если Docker CLI недоступен, установите Docker Desktop и повторите `pnpm db:up`.

## Локальная и production-база

Локальная разработка должна работать только с локальной PostgreSQL из Docker:

```bash
DATABASE_URL=postgres://welding:welding@localhost:5432/welding_tracker
```

Для локальных секретов используйте `.env.local` или `.env`. Эти файлы не коммитятся.

Production на Netlify использует только переменную окружения `DATABASE_URL`, заданную в Netlify UI. Не вставляйте production-строку подключения в локальные `.env` файлы, если не собираетесь осознанно запускать production-миграцию.
