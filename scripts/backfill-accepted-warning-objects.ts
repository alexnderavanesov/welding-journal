import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { loadServerEnv } from '../src/server-env'
loadServerEnv()
const url = new URL(process.env.DATABASE_URL ?? '')
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only explicitly selected local database is supported')
assert.equal(spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim(), 'main')
const [{ requireDb }, { backfillAcceptedWarningObjects }] = await Promise.all([import('../src/db/index'), import('../src/server/accepted-warning-backfill')])
const apply = process.argv.includes('--apply')
const db = requireDb()
try {
  console.log(JSON.stringify({ database: url.pathname.slice(1), apply,
    ...await db.transaction(tx => backfillAcceptedWarningObjects(tx, apply), { isolationLevel: 'repeatable read', accessMode: apply ? 'read write' : 'read only' }),
  }, null, 2))
} finally {
  await (db as unknown as { $client: import('pg').Pool }).$client.end()
}
