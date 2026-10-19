import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { getDispatcherTaskIndexSnapshot } from '../../src/server/dispatcher-task-index'
import { loadDispatcherTaskContext, normalizeDispatcherTaskContextRequest, type DispatcherTaskContextRequest } from '../../src/server/dispatcher-task-context'
import { rpcName } from '../rpc'
import { revealJournalColumn } from '../journal-grid'
import { revealPstoColumn } from './psto-grid-helpers'

const filler = 'AA E2E dispatcher context'
const project = 'ZZ E2E dispatcher context'
let ids: number[] = [], revision = -1
const getDispatcherTaskContext = ({ data }: { data: DispatcherTaskContextRequest }) => loadDispatcherTaskContext(normalizeDispatcherTaskContextRequest(data))
test.beforeAll(async () => {
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,d1,t1,officiality)
      select $1,'CTX','EARLY','F'||n,'2026-09-01','С17',108,4,'действующий' from generate_series(1,5300) n`, [filler])
    const seeded = await db.query<{id: number}>(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
      connection_type,d1,d2,t1,t2,material_group,welding_method,officiality,revision_actuality,
      has_vik,vik_result,has_uzk,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,
      psto_required,psto_result,psto_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date)
      select $1,'CTX','CONTEXT-LINE',joint,'2026-09-01','С17',108,108,4,4,'М01','РД','действующий','актуальная',
      'да','годен','да',result,'CTX-NK','2026-09-01','CTX-CON','2026-09-01',
      'да','проведено','2026-08-30','годен','CTX-TVMT','2026-08-31'
      from (values ('S991','вырез'),('S991R1','ремонт'),('S991R2','годен')) input(joint,result) returning id`, [project])
    ids = seeded.rows.map(row => row.id)
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,d1,t1)
      select $1,'CTX','CONTEXT-LINE','F'||n,'2026-09-01','С17',108,4 from generate_series(1,220) n`, [project])
  })
  const snapshot = await getDispatcherTaskIndexSnapshot({ ensureFresh: true })
  if ('encoding' in snapshot) throw new Error('Expected ordinary snapshot for server fixture')
  revision = snapshot.computedRevision
  expect(snapshot.isFresh).toBe(true)
  expect(snapshot.repeatedJointTaskCount).toBeGreaterThan(5000)
  expect(snapshot.repeatedJointTasks).toHaveLength(5000)
  expect(snapshot.repeatedJointTasks.some(task => task.row.projectTitle === project)).toBe(false)
})
test.afterAll(() => cleanupLineProgramProjects([filler, project]))

test('complete row context and bounded line pages beyond the global snapshot; stale revision refused', async () => {
  const context = await getDispatcherTaskContext({ data: { mode: 'rows', rowIds: [ids[2]], computedRevision: revision } })
  expect(context.tasks.some(task => task.kind === 'rename' && task.changes.some(change => change.rowId === ids[2]))).toBe(true)
  const first = await getDispatcherTaskContext({ data: { mode: 'line', rowIds: [ids[1]], computedRevision: revision } })
  expect(first.total).toBeGreaterThan(200)
  expect(first.tasks).toHaveLength(200)
  const second = await getDispatcherTaskContext({ data: { mode: 'line', rowIds: [ids[1]], computedRevision: revision, offset: 200 } })
  expect(second.total).toBe(first.total)
  expect(second.tasks.length).toBeGreaterThan(0)
  expect(new Set([...first.tasks, ...second.tasks].map(task => task.key)).size).toBe(first.tasks.length + second.tasks.length)
  await expect(getDispatcherTaskContext({ data: { mode: 'rows', rowIds: ids, computedRevision: revision - 1 } })).rejects.toThrow('Расчёт диспетчера изменился')
  await expect(getDispatcherTaskContext({ data: { mode: 'line', rowIds: [2147483647], computedRevision: revision } })).rejects.toThrow('Стык больше не существует')
})

for (const route of ['/journal', '/psto', '/lnk']) test(`beyond 5000: joint actions and whole-line count from ${route}`, async ({ page }) => {
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(route)
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('S991R1')
  const joint = page.getByRole('button', { name: 'S991R1', exact: true }).first()
  await expect(joint).toBeVisible()
  if (route === '/journal') await revealJournalColumn(page, 'jointNextAction')
  if (route === '/psto') await revealPstoColumn(page, 'jointNextAction')
  const nextAction = page.locator('[data-joint-next-action-cell]').getByRole('button', { name: /^Выполнить:/ }).first()
  await expect(nextAction).toBeVisible()
  await nextAction.click()
  await expect(page.getByRole('heading', { name: 'Картина стыка S991R1', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^Требует действия/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Переименовать в S991W1', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: /^Картина линии/ }).click()
  await expect(page.getByRole('button', { name: 'Загрузить ещё задачи линии' })).toBeVisible()
  const total = await getDispatcherTaskContext({ data: { mode: 'line', rowIds: [ids[1]], computedRevision: revision } })
  await expect(page.getByRole('tab', { name: `Картина линии · ${total.total}`, exact: true })).toBeVisible()
  await expect(page.getByText(`Загружено задач: 200 из ${total.total}`, { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Загрузить ещё задачи линии' }).click()
  await expect(page.getByText(`Загружено задач: 400 из ${total.total}`, { exact: false })).toBeVisible()
  await page.getByRole('tab', { name: 'Стык', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Переименовать S991R1 -> S991W1 (+1 далее)', exact: true })).toBeVisible()
  expect(calls.filter(name => name.startsWith('getDispatcherTaskContext')).length).toBeLessThanOrEqual(7)
  expect(errors).toEqual([])
})

test('dispatcher search opens an omitted task picture; a newer revision cannot retain obsolete cards', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('button', { name: 'Открыть диспетчер', exact: true }).click()
  const workspace = page.getByRole('dialog', { name: 'Диспетчер задач' })
  await workspace.getByRole('textbox', { name: 'Поиск задач диспетчера' }).fill('S991R1')
  await workspace.getByRole('textbox', { name: 'Поиск задач диспетчера' }).press('Enter')
  await workspace.getByRole('button', { name: 'Картина', exact: true }).first().click()
  await expect(page.getByRole('tab', { name: /^Требует действия/ })).toBeVisible()
  await expect(page.getByText('Описание действий обновляется.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Закрыть картину', exact: true }).click()
  await withLineProgramFixture(db => db.query("update weld_joints set joint=case joint when 'S991R1' then 'S991W1' when 'S991R2' then 'S991W1R1' else joint end where id=any($1::int[])", [ids]))
  const next = await getDispatcherTaskIndexSnapshot({ ensureFresh: true })
  if ('encoding' in next) throw new Error('Expected ordinary snapshot')
  await expect(getDispatcherTaskContext({ data: { mode: 'rows', rowIds: ids, computedRevision: revision } })).rejects.toThrow('Расчёт диспетчера изменился')
  revision = next.computedRevision
  await page.reload()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('S991W1R1')
  await page.getByRole('button', { name: 'S991W1R1', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Картина стыка S991W1R1', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Переименовать S991R1/ })).toHaveCount(0)
  expect((await withE2eDatabase(db => db.query('select count(*)::int as count from weld_joints where id=any($1::int[])', [ids]))).rows[0].count).toBe(3)
})
