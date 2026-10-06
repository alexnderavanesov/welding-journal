import { assertExplicitMigrationTarget, assertLocalMigrationDatabaseUrl } from './migration-branch-guard'

const remoteConfirmations = ['--backup-confirmed', '--maintenance-window-confirmed', '--release-deployed-confirmed']
export function parseReleaseCommand(args: string[], env: Record<string, string | undefined>) {
  const flags = new Set(args.filter(arg => arg !== '--'))
  const allowed = new Set(['--remote', '--local', '--apply-local', '--data-only', ...remoteConfirmations])
  if ([...flags].some(flag => !allowed.has(flag))) throw new Error('Неизвестный параметр команды выпуска.')
  if (flags.has('--remote') === flags.has('--local')) throw new Error('Выберите ровно одну цель: --remote или --local.')
  const remote = flags.has('--remote')
  if (remote) {
    if (flags.has('--data-only') || flags.has('--apply-local')) throw new Error('Удалённый выпуск разрешён только полной командой db:remote-migration.')
    if (remoteConfirmations.some(flag => !flags.has(flag))) {
      throw new Error('До подключения подтвердите резервную копию, паузу записи и завершённый деплой (старые контейнеры и задания остановлены): --backup-confirmed --maintenance-window-confirmed --release-deployed-confirmed')
    }
  } else if (!flags.has('--apply-local')) throw new Error('Для локального применения нужен --apply-local.')
  const databaseUrl = env[remote ? 'DATABASE_URL_REMOTE_FOR_MIGRATIONS' : 'DATABASE_URL']
  if (!databaseUrl) throw new Error(`${remote ? 'DATABASE_URL_REMOTE_FOR_MIGRATIONS' : 'DATABASE_URL'} is not configured`)
  let url: URL
  try { url = new URL(databaseUrl) } catch { throw new Error('Некорректный PostgreSQL URL выбранной цели.') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1)) throw new Error('Укажите PostgreSQL URL с именем базы.')
  assertExplicitMigrationTarget(url)
  if (!remote) {
    assertLocalMigrationDatabaseUrl(databaseUrl)
    if (!/^welding_tracker(?:_[a-z0-9_]+)?$/.test(decodeURIComponent(url.pathname.slice(1)))) throw new Error('Локальный выпуск разрешён только для явно выбранной базы welding_tracker или её тестовой базы.')
  }
  return { remote, dataOnly: flags.has('--data-only'), databaseUrl, host: url.hostname, database: decodeURIComponent(url.pathname.slice(1)) }
}

export function releaseMigrationSteps(remote: boolean) {
  return [
    ['tsx', 'scripts/prepare-legacy-weld-column-cleanup.ts', ...(remote ? ['--remote'] : [])],
    ['drizzle-kit', 'migrate', ...(remote ? ['--config=drizzle.remote.config.ts'] : [])],
    ['tsx', 'scripts/backfill-lnk-defect-descriptions.ts', ...(remote ? ['--remote'] : [])],
  ]
}
