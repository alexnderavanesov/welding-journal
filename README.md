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
