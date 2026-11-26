import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { withE2eDatabase } from '../database'

test('prewarm operator command requires its token and preserves a fresh publication', async ({ request }) => {
  test.skip(!process.env.MAINTENANCE_TOKEN, 'Explicit local operator token required')
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  const path = '/api/maintenance/dispatcher-prewarm'
  expect((await request.post(path)).status()).toBe(401)
  expect((await request.post(path, { headers: { authorization: 'Bearer incorrect-local-token' } })).status()).toBe(401)
  const run = () => promisify(execFile)(process.execPath, ['scripts/prewarm-dispatcher.mjs'], {
    env: { ...process.env, FORCE_COLOR: undefined, PORT: process.env.E2E_PORT || '3100' }, timeout: 60000,
  })
  const first = await run()
  expect(first.stderr).toBe('')
  expect(JSON.parse(first.stdout)).toMatchObject({ ready: true })
  const publication = () => withE2eDatabase(async db => (await db.query(
    'select xmin::text version,source_revision,computed_revision,computed_at from dispatcher_task_index_state where id=1')).rows[0])
  const before = await publication()
  const [second, third] = await Promise.all([run(), run()])
  expect(second.stderr).toBe('')
  expect(third.stderr).toBe('')
  expect(JSON.parse(second.stdout)).toEqual(JSON.parse(first.stdout))
  expect(JSON.parse(third.stdout)).toEqual(JSON.parse(first.stdout))
  expect(await publication()).toEqual(before)
})
