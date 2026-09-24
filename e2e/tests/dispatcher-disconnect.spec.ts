import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { DISPATCHER_REFRESH_LOCK_ID } from '@/server/dispatcher-task-index-constants'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'

test('уход со страницы не прерывает публикацию индекса и не запускает повторный пересчет', async ({ page, context }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Verifies the real built server entry and RPC manifest')
  const checked = await promisify(execFile)(process.execPath, ['scripts/verify-server-cancellation.mjs'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(checked.stderr).toBe('')
  expect(JSON.parse(checked.stdout.trim())).toEqual({ cancellations: 2, status: 499 })
  const serverDir = resolve('.output/server')
  const resolver = readdirSync(serverDir).find((name) => name.startsWith('__23tanstack-start-server-fn-resolver-'))!
  const source = readFileSync(resolve(serverDir, resolver), 'utf8')
  const match = [...source.matchAll(/"([a-f0-9]+)":\s*\{\s*functionName:\s*"([^\"]+)_createServerFn_handler"/g)]
    .find((entry) => entry[2] === 'refreshDispatcherTaskSnapshot')
  expect(match).toBeDefined()
  const path = `/_serverFn/${match![1]}`
  const errors: string[] = []
  const refreshes: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}`) })
  context.on('request', (request) => { if (new URL(request.url()).pathname === path) refreshes.push(request.url()) })
  await ensureDispatcherTaskIndexFresh()
  const before = await readPublishedIndex()
  await markDispatcherTaskIndexDirty()
  await withE2eDatabase(async (client) => {
    await client.query('select pg_advisory_lock($1)', [DISPATCHER_REFRESH_LOCK_ID])
    try {
      await page.goto('/journal')
      const other = await context.newPage()
      await other.goto('/journal')
      await expect.poll(() => refreshes.length).toBe(2)
      // Both browsers share one server calculation, waiting on our test lock.
      await expect.poll(async () => (await client.query(`select count(*)::int as count
        from pg_locks where locktype = 'advisory' and objid = $1 and not granted`, [DISPATCHER_REFRESH_LOCK_ID])).rows[0].count).toBe(1)
      await page.goto('/settings')
      await other.close()
      // Until commit, readers continue seeing the complete previous publication.
      expect(await readPublishedIndex()).toEqual(before)
    } finally {
      await client.query('select pg_advisory_unlock($1)', [DISPATCHER_REFRESH_LOCK_ID])
    }
  })
  await expect.poll(() => withE2eDatabase(async (client) => {
    const state = (await client.query('select source_revision, computed_revision, full_rebuild from dispatcher_task_index_state where id = 1')).rows[0]
    return state.source_revision === state.computed_revision && !state.full_rebuild
  })).toBe(true)
  expect((await readPublishedIndex()).computed_revision).not.toBe(before.computed_revision)
  await page.goto('/journal')
  await expect(page.getByLabel('Диспетчер задач', { exact: true })).toBeVisible()
  expect(refreshes).toHaveLength(2)
  expect(errors).toEqual([])
})

async function readPublishedIndex() {
  return withE2eDatabase(async (client) => (await client.query(`select computed_revision, repeated_tasks,
    (select coalesce(jsonb_agg(to_jsonb(t) order by weld_joint_id, task_key), '[]') from dispatcher_row_tasks t) as rows,
    (select coalesce(jsonb_agg(to_jsonb(t) order by scope_key, page_number), '[]') from dispatcher_task_pages t) as pages
    from dispatcher_task_index_state where id = 1`)).rows[0])
}
