import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { loadServerEnv } from '../src/server-env'
import { getDatabaseConnectionConfig } from '../src/db/ssl'
import { parseReleaseCommand, releaseMigrationSteps } from '../src/lib/release-command'

loadServerEnv()
// Reject missing confirmations, a wrong target or unpublished code BEFORE connecting.
const target = parseReleaseCommand(process.argv.slice(2), process.env)
run(['tsx', target.remote ? 'scripts/assert-remote-migration-release.ts' : 'scripts/assert-main-migration-branch.ts'])
process.env.DATABASE_URL = target.databaseUrl
process.env.WELDING_ENV_LOADED = '1'
const lock = new pg.Client({ ...getDatabaseConnectionConfig(target.databaseUrl, process.env.DATABASE_SSL_CA), connectionTimeoutMillis: 10_000 })
let databasePool: pg.Pool | undefined
try {
  await lock.connect()
  const identity = (await lock.query('select current_database() as database')).rows[0]
  if (identity.database !== target.database) throw new Error('Фактическая база не совпадает с выбранной целью.')
  const acquired = (await lock.query("select pg_try_advisory_lock(hashtext('maintenance:database-release:v1')) as acquired")).rows[0].acquired
  if (!acquired) throw new Error('Другой выпуск уже выполняется. Дождитесь его завершения.')
  console.log(JSON.stringify({ phase: 'start', host: target.host, database: target.database }))
  if (!target.dataOnly) for (const step of releaseMigrationSteps(target.remote)) run(step)
  const [{ requireDb }, { prepareReleaseData }, { isDatabaseReleaseReady }] = await Promise.all([
    import('../src/db/index'), import('../src/server/release-data-transition'), import('../src/server/release-readiness'),
  ])
  const db = requireDb()
  databasePool = (db as unknown as { $client: pg.Pool }).$client
  const data = await db.transaction(prepareReleaseData)
  if (!await isDatabaseReleaseReady(db)) throw new Error('Итоговая проверка готовности не пройдена.')
  console.log(JSON.stringify({ phase: 'complete', host: target.host, database: target.database, ready: true, data }, null, 2))
} finally {
  await databasePool?.end()
  await lock.end()
}

function run(args: string[]) {
  const result = spawnSync('pnpm', ['exec', ...args], { env: process.env, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Шаг ${args.slice(0, 2).join(' ')} не завершён. Выпуск остановлен; не допускайте пользователей. Код: ${result.status ?? result.signal ?? 'ошибка запуска'}.`)
}
