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

Production на Netlify использует переменную окружения `DATABASE_URL`, заданную в Netlify UI. Обычный запуск приложения и локальные миграции продолжают использовать только `DATABASE_URL`.

Для миграции удаленной базы добавьте отдельную переменную в `.env.local` или `.env`:

```bash
DATABASE_URL_REMOTE_FOR_MIGRATIONS=postgres://user:password@remote-host:5432/welding_tracker
```

Затем запустите специальную команду:

```bash
pnpm db:remote-migration
```

`db:remote-migration` не использует `DATABASE_URL` и завершится с ошибкой, если `DATABASE_URL_REMOTE_FOR_MIGRATIONS` не задана. Не коммитьте настоящую строку подключения удаленной базы.
