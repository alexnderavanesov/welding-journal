import { loadServerEnv } from '../src/server-env.ts'
loadServerEnv()
if (!process.argv.includes('--apply-local') || process.argv.includes('--remote')) throw new Error('Разрешён только явный локальный переход с --apply-local.')
const url = new URL(process.env.DATABASE_URL ?? '')
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/welding_tracker(?:_[a-z0-9_]+)?$/.test(url.pathname)) {
  throw new Error('Переход разрешён только для явно проверенной локальной БД welding_tracker. Удалённые цели запрещены.')
}
const { execFileSync } = await import('node:child_process')
if (execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim() !== 'main') throw new Error('Переход выполняется только на main.')
const { requireDb } = await import('../src/db/index.ts')
const { transitionLinePrograms, restoreLineProgramTransition } = await import('../src/server/line-program-transition.ts')
const result = await requireDb().transaction(process.argv.includes('--restore') ? restoreLineProgramTransition : transitionLinePrograms)
console.log(JSON.stringify({ host: url.hostname, database: url.pathname.slice(1), ...result }))
