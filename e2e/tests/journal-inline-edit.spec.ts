import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { revealJournalColumn, journalRow } from '../journal-grid'
import { asE2eOwner } from '../with-owner-access'
import { saveJournalCellEdits, pasteJournalCells } from '../../src/server/journal-inline-edit'
import { readJournalGrid } from '../../src/server/journal-grid'
import { rpcName } from '../rpc'
import type { JournalRangeRequest } from '../../src/lib/journal-server-grid'
import { getDispatcherTaskIndexSnapshot } from '../../src/server/dispatcher-task-index'
import { attachDispatcherTaskCodesToPage } from '../../src/server/weld-read'

const project = 'E2E inline journal'
const save = asE2eOwner(saveJournalCellEdits, 'welding.edit')
const paste = asE2eOwner(pasteJournalCells, 'welding.edit')
const read = asE2eOwner(readJournalGrid, 'welding.view')
const saved = (id: number) => withE2eDatabase(async db => (await db.query('select *,xmin::text version from weld_joints where id=$1', [id])).rows[0])
test.afterEach(async ({ page }) => { await page.close(); await cleanupLineProgramProjects([project]) })
async function seed(count = 220) {
  return withLineProgramFixture(async db => {
    const p = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,'INLINE','L','II','Б(а)',0,0) returning id`, [project])).rows[0].id
    return (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,category,group_name,weld_control_percent,pvk_control_percent,
      officiality,revision_actuality,has_vik,isometry,welding_electrodes,sheet)
      select $1,$2,'INLINE','L','F'||n,'II','Б(а)',0,0,'действующий','актуальная','да','ISO-'||n,'Электроды из подсказки',1
      from generate_series(1,$3) n returning id`, [p, project, count])).rows.map(row => Number(row.id))
  })
}
async function range(start: number, end: number): Promise<JournalRangeRequest> {
  const query = { report: 'weldingJournal' as const, columnFilters: { projectTitle: project }, sort: { fieldKey: 'id' as const, direction: 'asc' as const }, groupBy: [] }
  const page = await read({ ...query, route: [], start: 0, end: 100 })
  return { ...query, revision: page.revision, anchor: 'line', parts: [{ route: [], start, end, columns: ['weldingElectrodes'] }] }
}

test('version checks and atomic range saves cover unloaded rows, invalid input, managed fields and stale selection', async () => {
  const ids = await seed()
  const selection = await range(0, 220)
  expect(await paste({ range: selection, values: [['Общие электроды']] })).toEqual({ count: 220 })
  const values = await withE2eDatabase(async db => (await db.query('select distinct welding_electrodes from weld_joints where project_title=$1', [project])).rows)
  expect(values).toEqual([{ welding_electrodes: 'Общие электроды' }])
  await expect(paste({ range: selection, values: [['Устаревший диапазон']] })).rejects.toThrow()
  const first = await saved(ids[0]), second = await saved(ids[1])
  await save({ edits: [{ id: ids[1], version: second.version, values: { responsible: 'Другой пользователь' } }] })
  await expect(save({ edits: [
    { id: ids[0], version: first.version, values: { isometry: 'Не должно сохраниться' } },
    { id: ids[1], version: second.version, values: { isometry: 'Устаревшее' } },
  ] })).rejects.toThrow('изменен')
  expect((await saved(ids[0])).isometry).toBe(first.isometry)
  expect((await saved(ids[1])).responsible).toBe('Другой пользователь')
  await expect(save({ edits: [
    { id: ids[0], version: first.version, values: { isometry: 'Не должно сохраниться' } },
    { id: ids[1], version: (await saved(ids[1])).version, values: { sheet: 'не число' } },
  ] })).rejects.toThrow('число')
  expect((await saved(ids[0])).isometry).toBe(first.isometry)
  for (const field of ['spool', 'stamp1K', 'weldDate', 'vikResult', 'finalStatus', 'jsrDocument']) {
    await expect(save({ edits: [{ id: ids[0], version: first.version, values: { [field]: 'Запрещено' } }] })).rejects.toThrow('нельзя редактировать')
  }
  const groupedQuery = { report: 'weldingJournal' as const, columnFilters: { projectTitle: project }, groupBy: ['line' as const],
    sort: { fieldKey: 'id' as const, direction: 'desc' as const } }
  const grouped = await read({ ...groupedQuery, route: ['L'], start: 0, end: 100 })
  const groupedRange = { ...groupedQuery, revision: grouped.revision, anchor: 'line' as const,
    parts: [{ route: ['L'], start: 0, end: 2, columns: ['weldingElectrodes' as const, 'weldingElectrodesCertificateNumber' as const] }] }
  await expect(paste({ range: { ...groupedRange, parts: [{ ...groupedRange.parts[0], route: [] }] }, values: [['Нет']] })).rejects.toThrow()
  await expect(paste({ range: { ...groupedRange, parts: [{ ...groupedRange.parts[0], columns: ['weldingElectrodes', 'technologyCardNumber'] }] }, values: [['Нет']] })).rejects.toThrow()
  expect(await paste({ range: groupedRange, values: [['Э-220', 'С-220'], ['Э-219', 'С-219']] })).toEqual({ count: 2 })
  expect((await saved(ids.at(-1)!)).welding_electrodes).toBe('Э-220')
  expect((await saved(ids.at(-2)!)).welding_electrodes_certificate_number).toBe('С-219')
  expect((await saved(ids[0])).welding_electrodes).toBe('Общие электроды')
})

test('cell editor uses card suggestions, free typing, Escape and atomic rectangular paste without opening the card', async ({ page, context, browserName }, info) => {
  const ids = await seed(8)
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.addInitScript(() => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
  })))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  const grid = page.locator('[data-welding-journal-grid]'), frame = grid.locator('.journal-grid-frame')
  await expect(page.getByText('Найдено: 8', { exact: true })).toBeVisible()
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  expect(calls.filter(name => name.startsWith('listWeldFormSuggestions'))).toHaveLength(0)
  await revealJournalColumn(page, 'weldingElectrodes')
  const cell = journalRow(page, ids[0]).locator('[col-id="weldingElectrodes"]')
  await cell.dblclick()
  const editor = page.getByTestId('journal-inline-editor')
  await expect(editor).toBeVisible()
  // AG Grid gives its cell-editor popup role="dialog" as well.
  await expect(page.getByRole('dialog').filter({ hasNot: editor })).toHaveCount(0)
  const input = editor.getByRole('textbox', { name: 'Сварочные электроды', exact: true })
  await input.fill('')
  await expect(editor.getByRole('button', { name: /Электроды из подсказки/ })).toBeVisible()
  await editor.getByRole('button', { name: /Электроды из подсказки/ }).click()
  await expect(input).toHaveValue('Электроды из подсказки')
  await input.fill('Произвольные электроды')
  await page.screenshot({ path: info.outputPath('inline-suggestions.png') })
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect.poll(async () => (await saved(ids[0])).welding_electrodes).toBe('Произвольные электроды')
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  await expect(cell).toHaveText('Произвольные электроды')
  await cell.click(); await page.keyboard.press('F2')
  await expect(editor).toBeVisible(); await input.fill('Отмена'); await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  expect((await saved(ids[0])).welding_electrodes).toBe('Произвольные электроды')
  await cell.click()
  const rowIndex = await cell.evaluate(element => Number(element.closest('.ag-row')!.getAttribute('row-index')))
  const nextId = Number(await grid.locator(`.ag-row[row-index="${rowIndex + 1}"]`).first().getAttribute('row-id'))
  // A real DOM paste event exercises the handler in both Chrome and WebKit;
  // it does not depend on the host OS clipboard permissions.
  await cell.evaluate(element => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'Э-1\tС-1\nЭ-2\tС-2')
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
  })
  await expect.poll(async () => (await saved(ids[0])).welding_electrodes).toBe('Э-1')
  expect((await saved(ids[0])).welding_electrodes_certificate_number).toBe('С-1')
  expect((await saved(nextId)).welding_electrodes).toBe('Э-2')
  expect((await saved(nextId)).welding_electrodes_certificate_number).toBe('С-2')
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  await expect(cell).toHaveText('Э-1')
  await cell.click(); await page.keyboard.press('Shift+ArrowDown')
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate(() => navigator.clipboard.writeText('Одно на два'))
    await page.keyboard.press('ControlOrMeta+v')
  } else await cell.evaluate(element => {
      const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'Одно на два')
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
    })
  await expect.poll(async () => (await saved(nextId)).welding_electrodes).toBe('Одно на два')
  expect((await saved(ids[0])).welding_electrodes).toBe('Одно на два')
  await expect(cell).toHaveText('Одно на два')
  await cell.click(); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Delete')
  await expect.poll(async () => (await saved(nextId)).welding_electrodes).toBeNull()
  expect((await saved(ids[0])).welding_electrodes).toBeNull()
  expect((await saved(ids[0])).welding_electrodes_certificate_number).toBe('С-1')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a rejected edit names its joint and field, keeps stored values and has a dismissible compact message', async ({ page }, info) => {
  const [id] = await seed(1)
  await page.addInitScript(() => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
  })))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await revealJournalColumn(page, 'weldingElectrodes')
  await journalRow(page, id).locator('[col-id="weldingElectrodes"]').dblclick()
  const editor = page.getByTestId('journal-inline-editor')
  await editor.getByRole('textbox').fill('Не должно сохраниться')
  // A real concurrent modification remains a blocking error after allowing
  // unrelated corrections of legacy support composition.
  await withLineProgramFixture(db => db.query("update weld_joints set responsible='Другой пользователь' where id=$1", [id]))
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  const status = page.getByTestId('journal-inline-status')
  await expect(status).toContainText('Стык F1, линия L, поле «Сварочные электроды»: не сохранено')
  await expect(page.getByRole('status').filter({ hasText: 'изменен' })).toContainText('Стык F1')
  await page.screenshot({ path: info.outputPath('contextual-error.png') })
  expect((await saved(id)).welding_electrodes).toBe('Электроды из подсказки')
  await status.getByRole('button', { name: 'Закрыть сообщение о вводе в таблицу' }).click()
  await expect(status).toHaveCount(0)
})

test('pending save explains paste and clear separately and does not queue rejected actions', async ({ page }, info) => {
  const [id] = await seed(1)
  await page.addInitScript(() => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
  })))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  const frame = page.locator('.journal-grid-frame')
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  await revealJournalColumn(page, 'weldingElectrodes')
  const cell = journalRow(page, id).locator('[col-id="weldingElectrodes"]')
  await cell.click()
  let release!: () => void, requests = 0
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('pasteJournalCells')) {
      requests++
      if (requests === 1) await held
    }
    await route.continue()
  })
  const pasteText = (value: string) => cell.evaluate((element, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text)
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
  }, value)
  try {
    await pasteText('Первое изменение')
    await expect.poll(() => requests).toBe(1)
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('journal-inline-status')).toContainText('Очистка ячеек не выполнена')
    await expect(page.getByText('Очистка ячеек не выполнена: предыдущее изменение ещё сохраняется. Дождитесь завершения сохранения и обновления журнала, затем повторите очистку.', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('clear-while-saving.png') })
    await pasteText('Отклонённая вставка')
    await expect(page.getByTestId('journal-inline-status')).toContainText('Вставка в ячейки не выполнена')
    await expect(page.getByText('Вставка в ячейки не выполнена: предыдущее изменение ещё сохраняется. Дождитесь завершения сохранения и обновления журнала, затем повторите вставку.', { exact: true })).toBeVisible()
    expect(requests).toBe(1)
    expect((await saved(id)).welding_electrodes).toBe('Электроды из подсказки')
  } finally { release() }
  await expect.poll(async () => (await saved(id)).welding_electrodes).toBe('Первое изменение')
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  await page.reload()
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  expect(requests).toBe(1)
  expect((await saved(id)).welding_electrodes).toBe('Первое изменение')
})

test('legacy T composition allows wire paste and note clearing while retaining dispatcher warnings and saved facts', async ({ page }, info) => {
  const ids = await seed(3)
  await withLineProgramFixture(async db => {
    await db.query("update weld_joints set welding_journal_note='Примечание',filler_wire='Старая проволока' where id=any($1::int[])", [ids])
    await db.query("update weld_joints set joint='ОП-08',connection_type='Т1',material_group='М01 + М05',welding_method='РАД+РД' where id=$1", [ids[0]])
  })
  const previous = await saved(ids[0])
  await page.addInitScript(() => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
  })))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  const frame = page.locator('.journal-grid-frame')
  await expect(page.getByText('Найдено: 3', { exact: true })).toBeVisible()
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  await revealJournalColumn(page, 'fillerWire')
  const wire = journalRow(page, ids[0]).locator('[col-id="fillerWire"]')
  await wire.click()
  const rowIndex = await wire.evaluate(element => Number(element.closest('.ag-row')!.getAttribute('row-index')))
  const step = rowIndex === 0 ? 1 : -1
  const nextId = Number(await page.locator(`.ag-row[row-index="${rowIndex + step}"]`).first().getAttribute('row-id'))
  const extendSelection = () => page.keyboard.press(step === 1 ? 'Shift+ArrowDown' : 'Shift+ArrowUp')
  await extendSelection()
  await wire.evaluate(element => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'Св-08Г2С')
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
  })
  await expect.poll(async () => (await saved(ids[0])).filler_wire).toBe('Св-08Г2С')
  expect((await saved(nextId)).filler_wire).toBe('Св-08Г2С')
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  await revealJournalColumn(page, 'weldingJournalNote')
  const note = journalRow(page, ids[0]).locator('[col-id="weldingJournalNote"]')
  await note.click(); await extendSelection(); await page.keyboard.press('Delete')
  await expect.poll(async () => (await saved(ids[0])).welding_journal_note).toBeNull()
  expect((await saved(nextId)).welding_journal_note).toBeNull()
  const otherId = ids.find(id => id !== ids[0] && id !== nextId)!
  expect((await saved(otherId)).welding_journal_note).toBe('Примечание')
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  await note.dblclick()
  const editor = page.getByTestId('journal-inline-editor')
  await editor.getByRole('textbox').fill('Ручное уточнение')
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect.poll(async () => (await saved(ids[0])).welding_journal_note).toBe('Ручное уточнение')
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  await note.click(); await page.keyboard.press('Delete')
  await expect.poll(async () => (await saved(ids[0])).welding_journal_note).toBeNull()
  await expect(page.getByTestId('journal-inline-status')).toHaveText('Сохранено стыков: 1')
  expect(await saved(ids[0])).toMatchObject({ joint: previous.joint, connection_type: previous.connection_type,
    material_group: previous.material_group, welding_method: previous.welding_method })
  expect((await getDispatcherTaskIndexSnapshot({ ensureFresh: true })).isFresh).toBe(true)
  const tasks = await withE2eDatabase(db => db.query("select code from dispatcher_row_tasks where weld_joint_id=$1 and code='СП-13'", [ids[0]]))
  expect(tasks.rows).toEqual([{ code: 'СП-13' }])
  expect((await attachDispatcherTaskCodesToPage([{ id: ids[0], dispatcherTasks: '' }]))[0].dispatcherTasks).toContain('СП-13')
  await page.reload()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(page.getByText('Найдено: 3', { exact: true })).toBeVisible()
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  await revealJournalColumn(page, 'weldingJournalNote')
  await expect(note).toHaveText('')
  await page.screenshot({ path: info.outputPath('legacy-note-cleared.png') })
})
