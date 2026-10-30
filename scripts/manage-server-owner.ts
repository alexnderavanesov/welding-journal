import { loadServerEnv } from '../src/server-env'
import { assertExplicitMigrationTarget } from '../src/lib/migration-branch-guard'

// Operator-only entry point. No route, scheduled job or page imports this file.
// Run from the matching release checkout with its dependencies installed.
const args = process.argv.slice(2)
const action = args[0]
if (!['--prepare', '--recover'].includes(action) || args.length !== 3) {
  throw new Error('Укажите --prepare или --recover, --host=<проверенный хост> и --database=<точная база>.')
}
const host = args.find(arg => arg.startsWith('--host='))?.slice(7)
const database = args.find(arg => arg.startsWith('--database='))?.slice(11)
if (!host || !database) throw new Error('Нужны явно проверенные хост и имя базы.')
loadServerEnv()
const target = new URL(process.env.DATABASE_URL ?? '')
assertExplicitMigrationTarget(target)
if (!['postgres:', 'postgresql:'].includes(target.protocol) || target.hostname !== host || decodeURIComponent(target.pathname.slice(1)) !== database) {
  throw new Error('Подключение не совпадает с указанной оператором целью.')
}
if (process.env.AUTH_MAIL_MODE !== 'smtp' || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.SMTP_HOST || !process.env.BETTER_AUTH_URL?.startsWith('https://')) {
  throw new Error('До подготовки серверного владельца настройте HTTPS и доставку SMTP. Для локальной работы используйте prepare-local-owner.ts.')
}
const { requireDb, closeDatabase } = await import('../src/db')
const { sql } = await import('drizzle-orm')
try {
  const identity = await requireDb().execute(sql`select current_database() as name`)
  if (identity.rows[0]?.name !== database) throw new Error('Фактическая база не совпадает с указанной целью.')
  const { bootstrapOwner, recoverOwner } = await import('../src/server/account-management')
  const result = action === '--recover' ? await recoverOwner() : await bootstrapOwner({ name: 'Аванесов Александр', title: 'Директор', email: 'a.avanesov@yums.ru' })
  console.log(result.sent ? 'Одноразовая ссылка отправлена владельцу.' : result.message ?? 'Активный владелец сохранён; повторное приглашение не требуется.')
} finally { await closeDatabase() }
