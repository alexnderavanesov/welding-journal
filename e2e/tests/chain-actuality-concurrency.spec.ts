import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { requireDb } from '../../src/db'
import { previewChainActualityInTransaction } from '../../src/server/chain-actuality'
import { lockAllControlProcessSettings } from '../../src/server/control-process-settings-lock'
import { markDispatcherTaskIndexDirty } from '../../src/server/dispatcher-task-index-dirty'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E actuality process lock order'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('an actuality preview cannot deadlock a process transition updating the same chain', async () => {
  const rowId = await withLineProgramFixture(async db => (await db.query(`
    insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,
      has_vik,has_rk,psto_required,pre_heat_treatment_required,rk_request,rk_request_date,rk_result)
    values($1,'ACT-LOCK','ACT-LOCK-L','F8801','2026-10-01','С17','действующий',
      'да','да','да',null,'ACT-LOCK-PENDING','2026-11-01','ожидает НК') returning id`, [project])).rows[0].id as number)
  const application = `e2e-actuality-process-preview-${rowId}`
  await withE2eDatabase(async writer => {
    await writer.query('begin')
    let committed = false
    await writer.query("set local statement_timeout = '5s'")
    // The process-mode save owns these exclusive locks before updating flags.
    // Exercise its conflicting row write without changing other fixture settings.
    await lockAllControlProcessSettings(drizzle(writer), 'exclusive')
    const preview = requireDb().transaction(async tx => {
      await tx.execute(sql`select set_config('application_name', ${application}, true)`)
      return previewChainActualityInTransaction(tx, { rowId, active: false })
    }).then(value => ({ value, error: null }), error => ({ value: null, error }))
    try {
      await withE2eDatabase(async observer => {
        await expect.poll(async () => (await observer.query(`select count(*)::int as count from pg_stat_activity
          where datname=current_database() and application_name=$1 and wait_event_type='Lock' and wait_event='advisory'`,
        [application])).rows[0].count, { timeout: 5_000 }).toBe(1)
      })
      // Before the fix, the waiting preview already owned this row: each
      // transaction waited on the other until PostgreSQL aborted one (40P01).
      await writer.query(`update weld_joints set pre_heat_treatment_required=true,
        updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where id=$1`, [rowId])
      await markDispatcherTaskIndexDirty(drizzle(writer), { scopes: [{ projectTitle: project, subtitleCode: 'ACT-LOCK', line: 'ACT-LOCK-L' }] })
      await writer.query('commit')
      committed = true
      const result = await preview
      expect(result.error).toBeNull()
      expect(result.value).toMatchObject({ rowId, total: 1, changedCount: 1, pendingRequestCount: 1 })
    } finally {
      if (!committed) await writer.query('rollback')
      await preview
    }
  })
})
