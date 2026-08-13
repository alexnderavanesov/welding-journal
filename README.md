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

Если production-база требует собственный корневой SSL-сертификат, добавьте в Netlify переменную `DATABASE_SSL_CA` со всем PEM-содержимым сертификата, включая строки `BEGIN CERTIFICATE` и `END CERTIFICATE`. Для Yandex Cloud используйте `https://storage.yandexcloud.net/cloud-certs/CA.pem`. Приложение включает проверку сертификата и при наличии `DATABASE_SSL_CA` само удаляет конфликтующие SSL-параметры из `DATABASE_URL`.

Для миграции удаленной базы добавьте отдельную переменную в `.env.local` или `.env`:

```bash
DATABASE_URL_REMOTE_FOR_MIGRATIONS=postgres://user:password@remote-host:5432/welding_tracker
```

Затем запустите специальную команду:

```bash
pnpm db:remote-migration
```

`db:remote-migration` не использует `DATABASE_URL` и завершится с ошибкой, если `DATABASE_URL_REMOTE_FOR_MIGRATIONS` не задана. Не коммитьте настоящую строку подключения удаленной базы.

## Проверка перед публикацией

Полная локальная проверка запускается одной командой:

```bash
pnpm verify
```

Она проверяет TypeScript, весь набор тестов, production-сборку и зависимости. Production-граф должен проходить аудит без исключений.

В полном аудите временно разрешены два предупреждения, относящиеся только к инструментам разработки:

- `GHSA-67mh-4wv8-2f99` — старый внутренний `esbuild` стабильного `drizzle-kit`; он используется CLI миграций и не входит в production-сборку приложения.
- `GHSA-f88m-g3jw-g9cj` — `sharp` внутри последнего стабильного Netlify Vite plugin; он используется локальной эмуляцией Image CDN и не входит в production-зависимости приложения.

Исключения нужно удалить после появления совместимых стабильных версий Drizzle Kit и Netlify plugin. Принудительная установка несовместимых версий этих внутренних пакетов запрещена.
