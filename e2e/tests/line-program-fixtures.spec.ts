import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { DISPATCHER_BACKGROUND_INDEX_LOCK_ID, DISPATCHER_REFRESH_LOCK_ID } from '../../src/server/dispatcher-task-index-constants'

const project = 'E2E fixture cleanup'
test.afterEach(() => cleanupLineProgramProjects([project]))

const revisions = () => withE2eDatabase(async db => (await db.query(`select
  (select source_revision from dispatcher_task_index_state where id=1) as dispatcher,
  (select source_revision from derived_calculation_state where id=1) as derived`)).rows[0])

test('SQL seed и cleanup обновляют обе ревизии: тёплый раздел не сохраняет предыдущую фикстуру', async ({ page }) => {
  const seed = (line: string) => withLineProgramFixture(db => db.query(`insert into line_programs
    (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
    values ($1,'FIXTURE',$2,'II','A',10,0)`, [project, line]))
  const cards = page.locator('[data-testid="line-program-card"], [data-testid="line-program-detail"]')
  const open = async () => {
    await page.goto('/line-program')
    await page.getByLabel('Поиск программы линий').fill(project)
  }
  await seed('FIXTURE-FIRST')
  await open()
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAttribute('data-line', 'FIXTURE-FIRST')
  const beforeCleanup = await revisions()
  await cleanupLineProgramProjects([project])
  const afterCleanup = await revisions()
  expect(afterCleanup).toEqual({
    dispatcher: beforeCleanup.dispatcher + 1, derived: beforeCleanup.derived + 1,
  })
  await open()
  await expect(page.getByText('Линии не найдены. Попробуйте изменить поиск или фильтр.', { exact: true })).toBeVisible()
  await expect(cards).toHaveCount(0)
  // The empty result is now cached too; inserting the next fixture must expire it.
  await seed('FIXTURE-NEXT')
  expect(await revisions()).toEqual({
    dispatcher: afterCleanup.dispatcher + 1, derived: afterCleanup.derived + 1,
  })
  await open()
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAttribute('data-line', 'FIXTURE-NEXT')
  await page.close()
})

test('неудачный SQL setup откатывает данные, не публикуя новые ревизии', async () => {
  const before = await revisions()
  await expect(withLineProgramFixture(async db => {
    await db.query("insert into line_programs(project_title,subtitle_code,line) values ($1,'FIXTURE','FIXTURE-ROLLBACK')", [project])
    throw new Error('fixture rollback sentinel')
  })).rejects.toThrow('fixture rollback sentinel')
  expect(await revisions()).toEqual(before)
  expect(await withE2eDatabase(async db => (await db.query(
    "select id from line_programs where project_title=$1 and line='FIXTURE-ROLLBACK'", [project],
  )).rows)).toEqual([])
})

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
