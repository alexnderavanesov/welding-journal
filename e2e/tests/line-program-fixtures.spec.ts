import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { DISPATCHER_BACKGROUND_INDEX_LOCK_ID, DISPATCHER_REFRESH_LOCK_ID } from '../../src/server/dispatcher-task-index-constants'

const project = 'E2E fixture cleanup'
test.afterEach(() => cleanupLineProgramProjects([project]))

for (const [name, lock] of [['основной', DISPATCHER_REFRESH_LOCK_ID], ['фоновый', DISPATCHER_BACKGROUND_INDEX_LOCK_ID]] as const) {
  test(`очистка фикстур ждёт ${name} расчёт диспетчера до удаления стыков`, async () => {
    await withE2eDatabase(async db => {
      await db.query("insert into weld_joints (project_title, line, joint) values ($1, 'FIXTURE-CLEANUP', 'F1')", [project])
      await db.query('begin')
      await db.query('select pg_advisory_xact_lock($1)', [lock])
      let failure: unknown
      const cleanup = cleanupLineProgramProjects([project]).catch(error => { failure = error })
      try {
        await expect.poll(async () => Number((await db.query(
          "select count(*) from pg_locks where locktype='advisory' and objid=$1 and not granted", [lock],
        )).rows[0].count)).toBeGreaterThan(0)
        expect((await db.query('select count(*) from weld_joints where project_title=$1', [project])).rows[0].count).toBe('1')
      } finally {
        await db.query('commit')
        await cleanup
      }
      expect(failure).toBeUndefined()
      expect((await db.query('select count(*) from weld_joints where project_title=$1', [project])).rows[0].count).toBe('0')
    })
  })
}
