# Welding Tracker

Локальное веб-приложение для учета сварочных стыков трубопроводов.

## Стек

- TanStack Start + TypeScript
- Nitro Node server
- TanStack Query
- PostgreSQL 18 через Docker Compose
- Drizzle ORM
- Tailwind CSS + shadcn/ui-style components
- Vitest

## Запуск

```bash
curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=12.0.0-rc.7 sh -
```

Откройте новый терминал, затем выполните:

```bash
pnpm install
pnpm db:up
pnpm db:migrate
pnpm dev
```

Откройте `http://localhost:3000`.

Если Docker CLI недоступен, установите Docker Desktop и повторите `pnpm db:up`.

## Локальная база

Локальная разработка должна работать только с локальной PostgreSQL из Docker:

```bash
DATABASE_URL=postgres://welding:welding@localhost:5432/welding_tracker
```

Для локальных секретов используйте `.env.local` или `.env`. Эти файлы не коммитятся.

## Развертывание в Coolify

Создайте приложение из Git-репозитория с build pack `Dockerfile`. `docker-compose.yml` нужен только для локальной PostgreSQL и не используется для production-развертывания приложения.

Настройки приложения:

- Dockerfile location: `/Dockerfile`;
- приложение не является статическим сайтом, publish directory оставьте пустым;
- exposed port: `3000`;
- один экземпляр приложения.

Dockerfile устанавливает pnpm 12 официальным standalone-скриптом, затем собирает TanStack Start и Nitro в отдельном build-этапе. Рабочий образ содержит Node.js, pnpm, `package.json` и готовую папку `.output`; HTTP health check на `/` уже задан в образе.

Добавьте переменные окружения:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgres://user:password@postgres-host:5432/welding_tracker
DATABASE_POOL_MAX=5
DOCUMENT_TEMPLATE_STORAGE_PATH=/app/data/document-templates
MAINTENANCE_TOKEN=replace-with-a-long-random-secret
```

Создайте persistent volume с destination path `/app/data`. В нем хранятся только исходные Excel-шаблоны документов; записи журнала и метаданные остаются в PostgreSQL. Volume и базу нужно включить в резервное копирование.

Если production-база требует собственный корневой SSL-сертификат, добавьте `DATABASE_SSL_CA` со всем PEM-содержимым сертификата, включая строки `BEGIN CERTIFICATE` и `END CERTIFICATE`. Для Yandex Managed Service for PostgreSQL используйте `https://storage.yandexcloud.net/cloud-certs/CA.pem`. Приложение включает проверку сертификата и при наличии `DATABASE_SSL_CA` само удаляет конфликтующие SSL-параметры из `DATABASE_URL`.

Для ежедневного расчета фоновых кодов диспетчера создайте в Coolify Scheduled Task. Если планировщик работает в UTC, расписание `0 0 * * *` соответствует 03:00 МСК. Команда:

```bash
pnpm maintenance:dispatcher
```

Эндпоинт принимает только `POST` с секретом `MAINTENANCE_TOKEN`. Если фоновая проверка выключена в настройках приложения, задача безопасно завершится без расчета.

Перед переходом с Netlify или прежнего локального хранилища заранее скачайте каждый исходный Excel через `Настройки → Шаблоны документов → ⋯ → Скачать исходный шаблон`. После запуска Coolify замените соответствующие шаблоны этими файлами. Записи PostgreSQL не содержат сами Excel-файлы, поэтому одного переноса базы для шаблонов недостаточно.

### Production-миграции

Для миграции удаленной базы задайте отдельную переменную в локальном окружении администратора с установленными зависимостями проекта:

```bash
DATABASE_URL_REMOTE_FOR_MIGRATIONS=postgres://user:password@remote-host:5432/welding_tracker
```

Перед открытием новой версии приложения запустите:

```bash
pnpm db:remote-migration
```

`db:remote-migration` не использует `DATABASE_URL` и завершится с ошибкой, если `DATABASE_URL_REMOTE_FOR_MIGRATIONS` не задана. Рабочий Docker-образ не содержит исходный код, зависимости проекта или Drizzle CLI, поэтому миграцию запускают из локальной копии репозитория, а не из терминала контейнера. Не добавляйте production-миграции в start command и не коммитьте настоящую строку подключения удаленной базы.

## Проверка перед публикацией

Полная локальная проверка запускается одной командой:

```bash
pnpm verify
```

Она проверяет TypeScript, весь набор тестов, production-сборку и зависимости. Production-граф должен проходить аудит без исключений.

В полном аудите временно разрешено одно предупреждение `GHSA-67mh-4wv8-2f99`: оно относится к старому внутреннему `esbuild` стабильного `drizzle-kit`, который используется только CLI миграций и не входит в production-сборку приложения. Исключение нужно удалить после появления совместимой стабильной версии Drizzle Kit.
