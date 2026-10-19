import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { editJournalJoint, journalRow, revealJournalColumn } from '../journal-grid'
import { rpcName } from '../rpc'

const SELECTION_PROJECT = 'E2E AG grouped selection workflow'
const EDIT_PROJECT = 'E2E AG grouped edit workflow'
const VIEW_PROJECT = 'E2E AG overwritten view'
const projects = [SELECTION_PROJECT, EDIT_PROJECT, VIEW_PROJECT]

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects(projects)
})

async function openProject(page: Page, project: string, count: number) {
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText(`Загружено: ${Math.min(100, count)} из ${count}`, { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
}

async function groupBy(page: Page, field: string) {
  await revealJournalColumn(page, field)
  await page.locator(`.ag-header-cell[col-id="${field}"]`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Сгруппировать загруженные по/ }).click()
}

async function sortJoint(page: Page, direction: 'По возрастанию' | 'По убыванию') {
  await page.locator('.ag-header-cell[col-id="joint"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: direction, exact: true }).click()
  await page.waitForLoadState('networkidle')
}

async function filterIsometry(page: Page, value: string | null) {
  await revealJournalColumn(page, 'isometry')
  await page.locator('.ag-header-cell[col-id="isometry"] .ag-header-cell-filter-button').click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Изометрия', exact: true })
  if (value === null) await filter.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
  else {
    await filter.getByLabel('Найти значение фильтра').fill(value)
    await filter.getByRole('checkbox').check()
  }
  await page.keyboard.press('Escape')
  await page.waitForLoadState('networkidle')
}

async function saveView(page: Page, name: string) {
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида журнала', exact: true })
  await settings.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await settings.getByRole('textbox', { name: 'Название вида', exact: true }).fill(name)
  await settings.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(settings.getByRole('status')).toHaveText('Вид сохранён')
  await page.keyboard.press('Escape')
}

async function currentPreviewJoints(page: Page) {
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  const table = modal.frameLocator('iframe').locator('table')
  await expect(table.locator('tbody tr')).toHaveCount(50)
  const headers = await table.locator('thead th').allTextContents()
  const index = headers.indexOf('Стык')
  expect(index).toBeGreaterThanOrEqual(0)
  const joints = await table.locator('tbody tr').evaluateAll((rows, index) => rows.map(row => row.querySelectorAll('td')[index].textContent), index)
  await modal.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
  return joints
}

test('свёрнутая группа: выбор первых 100 сохраняет точные ID после подгрузки, сортировки и фильтра', async ({ page }) => {
  test.setTimeout(120_000)
  const seeded = await withE2eDatabase(async db => (await db.query<{ id: number; joint: string }>(`insert into weld_joints
    (project_title,subtitle_code,line,joint,connection_type,officiality,isometry)
    select $1,'GROUP','GROUP-SELECTION','F'||lpad(n::text,4,'0'),'СШ','действующий',
      case when n % 2 = 1 then 'ODD' else 'EVEN' end from generate_series(1,250) n returning id,joint`, [SELECTION_PROJECT])).rows)
  const selected = seeded.filter(row => Number(row.joint.slice(1)) <= 100)
  const errors: string[] = []
  const selectionRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (rpcName(request.url()).startsWith('listWeldJointRowsByIds_')) selectionRequests.push(request.postData() ?? '')
  })
  await openProject(page, SELECTION_PROJECT, 250)
  await sortJoint(page, 'По возрастанию')
  await groupBy(page, 'projectTitle')
  const group = page.locator('.ag-row-group.ag-row-level-0:not(.ag-opacity-zero)')
  await expect(group.locator('[data-group-summary="joint"]')).toHaveText('100')
  await group.getByRole('checkbox').check()
  await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 100')
  await page.getByRole('button', { name: 'Загрузить ещё', exact: true }).click()
  await expect(page.getByText('Загружено: 200 из 250', { exact: true })).toBeVisible()
  await expect(group.locator('[data-group-summary="joint"]')).toHaveText('200')
  await expect(group.getByRole('checkbox')).toBeChecked({ indeterminate: true })
  await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 100')
  await sortJoint(page, 'По убыванию')
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await expect(group.getByRole('checkbox')).not.toBeChecked()
  await filterIsometry(page, 'ODD')
  await expect(page.getByText('Загружено: 100 из 125', { exact: true })).toBeVisible()
  await expect(group.getByRole('checkbox')).toBeChecked({ indeterminate: true })
  await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 100')
  // Bring selected rows to the top again without scrolling near the page end
  // and accidentally loading another page.
  await sortJoint(page, 'По возрастанию')
  if (await group.getAttribute('aria-expanded') === 'false') await group.locator('.ag-group-contracted').click()
  const first = selected.find(row => row.joint === 'F0001')!
  await expect(journalRow(page, first.id).getByRole('checkbox')).toBeChecked()
  expect(selectionRequests).toHaveLength(0)
  // Only this explicit menu opening may hydrate the 50 selected IDs hidden by
  // the filter. Escape cancels the intent, consumes the key and keeps selection.
  let release!: () => void
  const gate = new Promise<void>(yes => { release = yes })
  let holdFirst = true
  await page.route('**/_serverFn/**', async route => {
    if (holdFirst && rpcName(route.request().url()).startsWith('listWeldJointRowsByIds_')) {
      holdFirst = false
      await gate
    }
    await route.continue()
  })
  const menu = page.getByTestId('context-action-menu')
  try {
    await journalRow(page, first.id).locator('[col-id="joint"]').click({ button: 'right' })
    await expect(menu).toContainText('Загружаем выбранные стыки…')
    await expect(menu.getByRole('button')).toHaveCount(0)
    await menu.click({ button: 'right' })
    expect(selectionRequests).toHaveLength(1)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 100')
    const settled = page.waitForResponse(response => rpcName(response.url()).startsWith('listWeldJointRowsByIds_'))
    release()
    await settled
    await page.waitForLoadState('networkidle')
    await expect(menu).toBeHidden()
    expect(selectionRequests).toHaveLength(1)
  } finally { release() }
  await journalRow(page, first.id).locator('[col-id="joint"]').click({ button: 'right' })
  await expect(menu).toContainText('Выбрано стыков: 100')
  await page.getByRole('button', { name: 'Фильтр выбранных (100)', exact: true }).click()
  expect(selectionRequests).toHaveLength(2)
  await expect(page.getByText('Загружено: 50 из 50', { exact: true })).toBeVisible()
  // This actual group command must keep all originally selected IDs, including
  // the 50 hidden by the isometry filter, and exclude every newly loaded ID.
  await saveView(page, 'Проверка выбранных')
  const actionIds = await page.evaluate(() => {
    const view = JSON.parse(localStorage.getItem('welding-report-view:v1:weldingJournal')!)
      .savedViews.find((item: { name: string }) => item.name === 'Проверка выбранных')
    return JSON.parse(view.snapshot.columnFilters.__rowIdList).rowIds as number[]
  })
  expect(actionIds.sort((a, b) => a - b)).toEqual(selected.map(row => row.id).sort((a, b) => a - b))
  expect(await currentPreviewJoints(page)).toEqual(Array.from({ length: 50 }, (_, index) => `F${String(index * 2 + 1).padStart(4, '0')}`))
  const remainingIds = () => withE2eDatabase(async db => (await db.query<{ id: number }>(
    'select id from weld_joints where project_title=$1 order by id', [SELECTION_PROJECT],
  )).rows.map(row => row.id))
  const openDelete = async () => {
    if (await group.getAttribute('aria-expanded') === 'false') await group.locator('.ag-group-contracted').click()
    await journalRow(page, first.id).locator('[col-id="joint"]').click({ button: 'right' })
    await page.getByRole('button', { name: 'Удалить выбранные (100)', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Удалить выбранные стыки', exact: true })
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText('100 стыков')
    return confirmation
  }
  // Fifty selected records remain outside the filter. Deletion must use their
  // captured versions as well; the visible page cannot supply these guards.
  const canceled = await openDelete()
  expect(selectionRequests).toHaveLength(3)
  await canceled.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(canceled).toBeHidden()
  expect(await remainingIds()).toEqual(seeded.map(row => row.id).sort((a, b) => a - b))
  await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 100')
  const confirmed = await openDelete()
  expect(selectionRequests).toHaveLength(4)
  await confirmed.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByText('Удалено стыков: 100', { exact: true })).toBeVisible()
  const selectedIds = new Set(selected.map(row => row.id))
  await expect.poll(remainingIds).toEqual(seeded.filter(row => !selectedIds.has(row.id)).map(row => row.id).sort((a, b) => a - b))
  await expect(page.getByLabel('Статистика выделения')).not.toContainText('Выбрано:')
  expect(errors).toEqual([])
})

test('личный вид: перезапись и удаление согласованно сохраняют поля, порядок, закрепление и группировку', async ({ page }) => {
  await withE2eDatabase(db => db.query(`insert into weld_joints (project_title,subtitle_code,line,joint)
    values ($1,'VIEW','GROUP-VIEW','F0001')`, [VIEW_PROJECT]))
  await openProject(page, VIEW_PROJECT, 1)
  await saveView(page, 'Рабочая смена')
  const originalId = await page.evaluate(() => JSON.parse(localStorage.getItem('welding-report-view:v1:weldingJournal')!).savedViews[0].id)
  await groupBy(page, 'projectTitle')
  await page.locator('.ag-header-cell[col-id="subtitleCode"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true }).click()
  await page.locator('.ag-header-cell[col-id="projectTitle"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
  await page.getByRole('menuitemcheckbox', { name: 'Слева', exact: true }).click()
  await expect(page.locator('.ag-header-cell[col-id="projectTitle"] .journal-column-pin')).toHaveAttribute('title', /Закреплён слева/)
  const line = page.locator('.ag-header-cell[col-id="line"]'), joint = page.locator('.ag-header-cell[col-id="joint"]')
  await line.hover()
  await joint.hover()
  const from = (await line.boundingBox())!, to = (await joint.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width - 12, to.y + to.height / 2, { steps: 20 })
  await page.mouse.up()
  await expect.poll(async () => (await line.boundingBox())!.x).toBeGreaterThan((await joint.boundingBox())!.x)
  // A case-insensitive name updates the existing view instead of duplicating it.
  await saveView(page, 'РАБОЧАЯ СМЕНА')
  const overwritten = await page.evaluate(() => ({
    views: JSON.parse(localStorage.getItem('welding-report-view:v1:weldingJournal')!).savedViews,
    layouts: JSON.parse(localStorage.getItem('welding-journal-ag-grid:v1')!).views,
  }))
  expect(overwritten.views).toHaveLength(1)
  expect(overwritten.views[0].id).toBe(originalId)
  expect(overwritten.views[0].snapshot.hiddenFieldKeys).toContain('subtitleCode')
  expect(Object.keys(overwritten.layouts)).toEqual(['рабочая смена'])
  const savedColumns = overwritten.layouts['рабочая смена'].columns as Array<{ colId: string; pinned: string | null; rowGroup: boolean }>
  expect(savedColumns.find(column => column.colId === 'projectTitle')).toMatchObject({ pinned: 'left', rowGroup: true })
  expect(savedColumns.findIndex(column => column.colId === 'joint')).toBeLessThan(savedColumns.findIndex(column => column.colId === 'line'))
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида журнала', exact: true })
  await settings.getByRole('tab', { name: 'Оформление', exact: true }).click()
  await settings.getByRole('button', { name: 'Сбросить столбцы', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  await settings.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await settings.getByRole('button', { name: /^РАБОЧАЯ СМЕНА Фильтров:/ }).click()
  await expect(page.getByRole('button', { name: 'Группировка: Проект', exact: true })).toBeVisible()
  await expect(page.locator('.ag-header-cell[col-id="subtitleCode"]')).toHaveCount(0)
  await expect(page.locator('.ag-header-cell[col-id="projectTitle"] .journal-column-pin')).toHaveAttribute('title', /Закреплён слева/)
  await expect.poll(async () => (await line.boundingBox())!.x).toBeGreaterThan((await joint.boundingBox())!.x)
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  await settings.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await settings.getByRole('button', { name: 'Удалить вид РАБОЧАЯ СМЕНА', exact: true }).click()
  await expect(settings.getByText('Сохранённых видов пока нет')).toBeVisible()
  await page.reload()
  const deleted = await page.evaluate(() => ({
    views: JSON.parse(localStorage.getItem('welding-report-view:v1:weldingJournal')!).savedViews,
    layouts: JSON.parse(localStorage.getItem('welding-journal-ag-grid:v1')!).views,
  }))
  expect(deleted).toEqual({ views: [], layouts: {} })
  // Removing a preset does not reset the user's currently applied layout.
  await expect(page.getByRole('button', { name: 'Группировка: Проект', exact: true })).toBeVisible()
  await expect(page.locator('.ag-header-cell[col-id="subtitleCode"]')).toHaveCount(0)
})

test('сохранение поля группировки и фильтра: стык уходит из выборки и появляется в новой группе с тем же ID', async ({ page }) => {
  const rows = await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs
      (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'GROUP','GROUP-EDIT','II','Б(а)',10,10) returning id`, [EDIT_PROJECT])
    return (await db.query<{ id: number; joint: string }>(`insert into weld_joints
      (line_program_id,project_title,subtitle_code,line,joint,category,group_name,weld_control_percent,pvk_control_percent,
       connection_type,officiality,isometry,sheet,revision_number)
      select $1,$2,'GROUP','GROUP-EDIT','F000'||n,'II','Б(а)',10,10,'СШ','действующий',
        case when n < 3 then 'GROUP-A' else 'GROUP-B' end,1,0 from generate_series(1,3) n returning id,joint`, [line.id, EDIT_PROJECT])).rows
  })
  const edited = rows.find(row => row.joint === 'F0002')!, remaining = rows.find(row => row.joint === 'F0001')!
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openProject(page, EDIT_PROJECT, 3)
  await groupBy(page, 'isometry')
  await filterIsometry(page, 'GROUP-A')
  await sortJoint(page, 'По убыванию')
  await expect(page.getByText('Загружено: 2 из 2', { exact: true })).toBeVisible()
  const groupA = page.locator('.ag-row-group:not(.ag-opacity-zero)').filter({ has: page.getByText('GROUP-A', { exact: true }) })
  await expect(groupA.locator('[data-group-summary="joint"]')).toHaveText('2')
  await groupA.locator('.ag-group-contracted').click()
  await editJournalJoint(page, edited.id)
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  await editor.getByRole('button', { name: 'Стык', exact: true }).first().click()
  await editor.getByRole('textbox', { name: 'Изометрия', exact: true }).fill('GROUP-B')
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(page.getByText('Загружено: 1 из 1', { exact: true })).toBeVisible()
  await expect(groupA.locator('[data-group-summary="joint"]')).toHaveText('1')
  await expect(journalRow(page, edited.id)).toHaveCount(0)
  await expect(page.getByTestId('context-action-menu')).toHaveCount(0)
  if (await groupA.getAttribute('aria-expanded') === 'false') await groupA.locator('.ag-group-contracted').click()
  await editJournalJoint(page, remaining.id)
  await expect(editor.getByRole('textbox', { name: 'Стык', exact: true })).toHaveValue('F0001')
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
  await filterIsometry(page, null)
  await expect(page.getByText('Загружено: 3 из 3', { exact: true })).toBeVisible()
  const groupB = page.locator('.ag-row-group:not(.ag-opacity-zero)').filter({ has: page.getByText('GROUP-B', { exact: true }) })
  await expect(groupA.locator('[data-group-summary="joint"]')).toHaveText('1')
  await expect(groupB.locator('[data-group-summary="joint"]')).toHaveText('2')
  if (await groupB.getAttribute('aria-expanded') === 'false') await groupB.locator('.ag-group-contracted').click()
  await editJournalJoint(page, edited.id)
  await expect(editor.getByRole('textbox', { name: 'Стык', exact: true })).toHaveValue('F0002')
  await editor.getByRole('button', { name: 'Стык', exact: true }).first().click()
  await expect(editor.getByRole('textbox', { name: 'Изометрия', exact: true })).toHaveValue('GROUP-B')
  expect(await withE2eDatabase(async db => (await db.query('select isometry from weld_joints where id=$1', [edited.id])).rows[0].isometry)).toBe('GROUP-B')
  expect(errors).toEqual([])
})
