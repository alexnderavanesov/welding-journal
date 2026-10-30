import { loadServerEnv } from '../src/server-env'
import { assertLocalMigrationDatabaseUrl } from '../src/lib/migration-branch-guard'
loadServerEnv()
assertLocalMigrationDatabaseUrl(process.env.DATABASE_URL)
const url = new URL(process.env.DATABASE_URL ?? '')
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/welding_tracker') throw new Error('Команда разрешена только для основной локальной БД welding_tracker.')
if (process.env.AUTH_MAIL_MODE !== 'local') throw new Error('Для локального владельца необходим изолированный приёмник писем.')
const { bootstrapOwner, recoverOwner } = await import('../src/server/account-management')
const { requireDb, closeDatabase } = await import('../src/db')
try {
  const command = process.argv[2]
  if (!['--prepare', '--recover'].includes(command)) throw new Error('Укажите --prepare для приглашения или --recover для восстановления существующего владельца.')
  const { sql } = await import('drizzle-orm')
  const actual = await requireDb().execute(sql`select current_database() as name`)
  if (actual.rows[0]?.name !== 'welding_tracker') throw new Error('Фактическая база не совпадает с основной локальной БД.')
  const result = command === '--recover' ? await recoverOwner() : await bootstrapOwner({ name: 'Аванесов Александр', title: 'Директор', email: 'a.avanesov@yums.ru' })
  console.log(result.sent ? 'Письмо записано в локальный закрытый каталог AUTH_MAIL_LOCAL_DIR (по умолчанию data/auth-mail). Реальной отправки нет.' : result.message)
} finally { await closeDatabase() }
