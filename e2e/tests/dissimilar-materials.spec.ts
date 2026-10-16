import { editJournalJoint } from '../journal-grid'
import { expect, test, type Locator } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E разнородные материалы'
const stampCode = 'MTA1'
const permit = (materialGroups: string, diameterFrom: string, diameterTo: string, thicknessFrom: string, thicknessTo: string) => ({
  id: materialGroups, weldType: 'РАД', materialGroups, diameterFrom, diameterTo, thicknessFrom, thicknessTo,
  validFrom: '2026-01-01', validTo: '2026-12-31', note: '',
})
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(db => db.query('delete from welder_stamps where naks_stamp=$1', [stampCode]))
})

async function setup() {
  const id = await withE2eDatabase(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs
      (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'MATERIALS','MATERIAL-SIDES','II','Б(а)',10,10) returning id`, [project])
    await db.query(`insert into welder_stamps(naks_stamp,welder_name,naks_permits) values ($1,'Материал: проверка сторон',$2)`,
      [stampCode, JSON.stringify([permit('М05', '1', '57', '1', '3'), permit('М01', '159', '500', '8', '40')])])
    return (await db.query(`insert into weld_joints
      (line_program_id,project_title,subtitle_code,line,joint,category,group_name,weld_control_percent,pvk_control_percent,
       connection_type,material_group,welding_method,d1,t1,d2,t2,has_vik,weld_date)
      values ($1,$2,'MATERIALS','MATERIAL-SIDES','F982','II','Б(а)',10,10,'У19','М05','РАД',57,3,159,8,'да','2026-07-01') returning id`,
      [program.id, project])).rows[0].id as number
  })
  // SQL fixtures bypass normal mutation invalidation. Establish the derived
  // status/version before opening an editor: this test exercises material sides,
  // not a stale save racing the initial background status calculation.
  const [{ requireDb }, { markDispatcherTaskIndexDirty }, { ensureDispatcherTaskIndexFresh }] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'), import('../../src/server/dispatcher-task-index'),
  ])
  await markDispatcherTaskIndexDirty(requireDb(), { scopes: [{ projectTitle: project, subtitleCode: 'MATERIALS', line: 'MATERIAL-SIDES' }] })
  await ensureDispatcherTaskIndexFresh()
  return id
}
const saved = (id: number) => withE2eDatabase(async db => (await db.query('select material_group,stamp_1_k,d1::float,t1::float,d2::float,t2::float from weld_joints where id=$1', [id])).rows[0])

test('поля сварки: стабильные размеры, компактная подсказка и узкое окно', async ({ page }) => {
  const id = await setup()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await editJournalJoint(page, 'F982')
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка' }) })
  const groups = editor.getByRole('group', { name: 'Группа материалов', exact: true })
  const methods = editor.getByRole('group', { name: 'Способ сварки', exact: true })
  const connection = editor.getByRole('combobox', { name: 'Тип соединения', exact: true })
  const help = editor.getByRole('button', { name: 'Как выбрать группы материалов' })
  const swap = groups.getByRole('button', { name: 'Поменять 1 ↔ 2', exact: true })
  const clear = groups.getByRole('button', { name: 'Очистить', exact: true })
  const box = async (locator: Locator) => {
    const value = await locator.boundingBox()
    expect(value).not.toBeNull()
    return value!
  }
  // Relative measurements ignore legitimate scrolling inside the form, but detect
  // selection-driven shifts of the chips, actions, field and following row.
  const layout = async () => {
    const group = await box(groups)
    const d1 = await box(editor.getByRole('textbox', { name: 'D1', exact: true }))
    const buttons = await Promise.all((await groups.getByRole('button').all()).map(box))
    return [group.width, group.height, d1.y - group.y, ...buttons.flatMap(button =>
      [button.x - group.x, button.y - group.y, button.width, button.height])]
  }
  const expectStable = async (baseline: number[]) => {
    const current = await layout()
    expect(current).toHaveLength(baseline.length)
    current.forEach((value, index) => expect(Math.abs(value - baseline[index])).toBeLessThanOrEqual(1))
  }
  for (const width of [1600, 1280, 1100, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await groups.scrollIntoViewIfNeeded()
    const baseline = await layout()
    const fields = await Promise.all([groups, methods, connection].map(box))
    fields.forEach(field => expect(field.height).toBe(48))
    expect(fields[0].width).toBeLessThanOrEqual(width)
    if (width >= 1280) {
      expect(Math.max(...fields.map(field => field.y)) - Math.min(...fields.map(field => field.y))).toBeLessThanOrEqual(1)
      expect(baseline[2] - 48).toBeLessThan(55) // No permanent two-line helper under the row.
    }
    await clear.click()
    await expect(clear).toBeDisabled()
    await expect(swap).toBeDisabled()
    await expectStable(baseline)
    await groups.getByRole('button', { name: 'М05', exact: true }).click()
    await expectStable(baseline)
    await groups.getByRole('button', { name: 'М01', exact: true }).click()
    await expectStable(baseline)
    await swap.click()
    await expectStable(baseline)
    await help.hover()
    await expect(page.getByRole('tooltip')).toContainText('1 — D1/T1, 2 — D2/T2')
    await expectStable(baseline)
    await help.click()
    await page.mouse.move(0, 0)
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toBeHidden()
    await expect(editor).toBeVisible()
    await expectStable(baseline)
    await methods.getByRole('button', { name: 'Очистить', exact: true }).click()
    expect((await box(methods)).height).toBe(48)
    await methods.getByRole('button', { name: 'РАД', exact: true }).click()
    expect((await box(methods)).height).toBe(48)
    if (width === 1600) {
      await groups.scrollIntoViewIfNeeded()
      await editor.screenshot({ path: '/private/tmp/weld-stable-fields.png' })
      await help.hover()
      await page.screenshot({ path: '/private/tmp/weld-stable-fields-help.png' })
      await page.mouse.move(0, 0)
    }
  }
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await saved(id)).material_group).toBe('М05') // Layout checks never save the fixture.
  expect(errors).toEqual([])
})

test('форма: номера сторон, максимум две группы, сохранение порядка и диагностика при перестановке', async ({ page }) => {
  const id = await setup()
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/journal')
  await editJournalJoint(page, id)
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка' }) })
  const groups = editor.getByRole('group', { name: 'Группа материалов', exact: true })
  await expect(groups.getByRole('button', { name: 'М05', exact: true })).toContainText('1/2')
  await groups.getByRole('button', { name: 'М01', exact: true }).click()
  await expect(groups.getByRole('button', { name: 'М05', exact: true })).toHaveText('М051')
  await expect(groups.getByRole('button', { name: 'М01', exact: true })).toHaveText('М012')
  await expect(groups.getByRole('button', { name: 'М11', exact: true })).toBeDisabled()
  await editor.getByRole('combobox', { name: 'Корень_1', exact: true }).selectOption(stampCode)
  await expect(editor.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()
  await groups.scrollIntoViewIfNeeded()
  await editor.screenshot({ path: '/private/tmp/weld-material-sides.png' })
  // Saving starts a dispatcher refresh followed by a report refresh. Wait for
  // that causal chain, not a 500ms guess, before measuring draft-only changes.
  let dispatcherRefreshed = false
  const refreshedReport = page.waitForResponse(response => {
    const name = rpcName(response.url())
    if (name.startsWith('refreshDispatcherTaskSnapshot_')) dispatcherRefreshed = true
    return dispatcherRefreshed && name.startsWith('listWeldingJournalPage_')
  })
  // Still awaited below; avoid a second unhandled rejection if an earlier
  // assertion fails and afterEach closes the page first.
  void refreshedReport.catch(() => {})
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(await (await refreshedReport).finished()).toBeNull()
  expect(await saved(id)).toMatchObject({ material_group: 'М05 + М01', stamp_1_k: stampCode, d1: 57, t1: 3, d2: 159, t2: 8 })
  await editJournalJoint(page, id)
  await expect(groups.getByRole('button', { name: 'М05', exact: true })).toHaveText('М051')
  calls.length = 0
  await groups.getByRole('button', { name: 'Поменять 1 ↔ 2', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
  await expect(editor.getByText(/Материал 1: М01; D1 = 57/).first()).toBeVisible()
  await expect(editor.getByText(/Материал 2: М05; D2 = 159/).first()).toBeVisible()
  await page.waitForTimeout(500)
  expect(calls).toEqual([]) // Changing groups is a local calculation, not a row-by-row RPC.
  await groups.getByRole('button', { name: 'Поменять 1 ↔ 2', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await saved(id)).material_group).toBe('М05 + М01')
  expect(errors).toEqual([])
})

test('сохраненные стыки: СП-02 в индексе и виртуальной колонке; использование справочника одним SQL', async () => {
  const id = await setup()
  await withE2eDatabase(db => db.query('update weld_joints set material_group=$2,stamp_1_k=$3 where id=$1', [id, 'М01 + М05', stampCode]))
  const [{ requireDb }, { markDispatcherTaskIndexDirty }, dispatcher, read, schema, pg] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'), import('../../src/server/dispatcher-task-index'),
    import('../../src/server/weld-read'), import('../../src/db/schema'), import('pg'),
  ])
  const db = requireDb()
  await markDispatcherTaskIndexDirty(db)
  await dispatcher.ensureDispatcherTaskIndexFresh()
  expect(await withE2eDatabase(async client => (await client.query('select code from dispatcher_row_tasks where weld_joint_id=$1', [id])).rows.map(row => row.code))).toContain('СП-02')
  const pages = await withE2eDatabase(async client => (await client.query('select tasks from dispatcher_task_pages')).rows)
  const cards = pages.flatMap(page => JSON.parse(page.tasks)).filter(task => task.row.id === id)
  expect(JSON.stringify(cards)).toContain('Материал 2: М05')
  const prototype = pg.default.Client.prototype, original = prototype.query
  let statements = 0
  prototype.query = function (this: unknown, ...args: unknown[]) { statements++; return (original as (...args: unknown[]) => unknown).apply(this, args) } as typeof original
  try {
    const virtual = await read.attachDispatcherTaskCodesToPage([{ id }])
    expect(virtual[0]).toMatchObject({ dispatcherTasks: expect.stringContaining('СП-02') })
    expect(statements).toBe(1)
    statements = 0
    const usage = new Map(await read.listMultiValueUsage(schema.weldJoints.materialGroup, '[+]'))
    expect(usage.get('М01')).toBe(1)
    expect(usage.get('М05')).toBe(1)
    expect(usage.has('М01 + М05')).toBe(false)
    expect(statements).toBe(1)
  } finally { prototype.query = original }
  // Correcting only the group order clears the qualification task, not the dimensions.
  await withE2eDatabase(client => client.query('update weld_joints set material_group=$2 where id=$1', [id, 'М05 + М01']))
  await markDispatcherTaskIndexDirty(db, { scopes: [{ projectTitle: project, subtitleCode: 'MATERIALS', line: 'MATERIAL-SIDES' }] })
  await dispatcher.ensureDispatcherTaskIndexFresh()
  expect((await read.attachDispatcherTaskCodesToPage([{ id }]))[0]).not.toMatchObject({ dispatcherTasks: expect.stringContaining('СП-02') })
  expect((await saved(id)).material_group).toBe('М05 + М01')
  await withE2eDatabase(client => client.query(`insert into weld_joints(project_title,subtitle_code,line,joint,material_group)
    values ($1,'MATERIALS','MATERIAL-SIDES','F983','М01 + М05')`, [project]))
  const columnFilters = { projectTitle: `=${project}` }
  const options = await read.listColumnFilterOptions(read.normalizeWeldColumnFilterOptionsRequest({ fieldKey: 'materialGroup', columnFilters }))
  expect(options).toEqual(expect.arrayContaining([
    expect.objectContaining({ value: 'М05 + М01', count: 1 }),
    expect.objectContaining({ value: 'М01 + М05', count: 1 }),
  ]))
  for (const materialGroup of ['М05 + М01', 'М01 + М05']) {
    const result = await read.listReportPage('weldingJournal', read.normalizeWeldPageRequest({ columnFilters: { ...columnFilters, materialGroup: `=${materialGroup}` } }))
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].materialGroup).toBe(materialGroup)
  }
})
