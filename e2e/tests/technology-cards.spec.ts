import { editJournalJoint } from '../journal-grid'
import { expect, test, type Page, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { createWeldJoint, updateWeldJoint } from '@/server/weld-mutations'
import { importWeldJoints, massFillWeldJoints, replaceWeldJoints } from '@/server/weld-import'
import { changeCard } from '@/server/technology-cards'
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'
import { attachDispatcherTaskCodesToPage } from '@/server/weld-read'
import { readJournalGrid } from '@/server/journal-grid'
import { buildDispatcherTaskServerFilters } from '@/lib/dispatcher-task-row-codes'
import type { WeldInput } from '@/lib/weld-fields'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { loadRemoteGeneratedDocumentRows } from '@/server/generated-documents'
import { DISPATCHER_INDEX_LOCK_ID, DISPATCHER_REFRESH_LOCK_ID } from '@/server/dispatcher-task-index-constants'

const project = 'E2E Технологические карты'
const name = 'E2E ТК №12'
const parameters = { name, weldingMethods: ['РАД'], connectionType: 'С17', materialGroups: ['М01'], diameterFrom: 57, diameterTo: 159, thicknessFrom: 3, thicknessTo: 8, psto: 'any' }
const base: WeldInput = { projectTitle: project, subtitleCode: 'TK', line: 'TK-LINE', category: 'II', groupName: 'Б(а)', weldControlPercent: 0, pvkControlPercent: 0,
  weldingMethod: 'РАД', connectionType: 'С17', materialGroup: 'М01', d1: 57, d2: 159, t1: 6, t2: 3,
  stamp1KFact: 'TKA1', stamp1ZFact: 'TKA1', stamp1OFact: 'TKA1', weldingElectrodes: 'Не изменять электроды', fillerWire: 'Не изменять проволоку' }

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('begin')
    await db.query('select pg_advisory_xact_lock($1)', [DISPATCHER_REFRESH_LOCK_ID])
    await db.query('select pg_advisory_xact_lock($1)', [DISPATCHER_INDEX_LOCK_ID])
    await db.query("delete from technology_cards where name like 'E2E %'")
    await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
    await db.query('commit')
  })
})
const saved = (id: number) => withE2eDatabase(async db => (await db.query('select *, xmin::text as version from weld_joints where id=$1', [id])).rows[0])
const registry = (value = name) => withE2eDatabase(async db => (await db.query('select * from technology_cards where name=$1', [value])).rows[0])
const virtualTasks = (id: number) => attachDispatcherTaskCodesToPage<{ id: number; dispatcherTasks?: string }>([{ id }])
async function waitForPublishedDispatcher() {
  await expect.poll(() => withE2eDatabase(async db => (await db.query('select source_revision=computed_revision as fresh from dispatcher_task_index_state where id=1')).rows[0]?.fresh), { timeout: 10_000 }).toBe(true)
}
async function addCard(page: Page, value = name) {
  await page.getByRole('button', { name: 'Добавить ТК', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Название ТК', { exact: true }).fill(value)
  await dialog.getByLabel('РАД', { exact: true }).check()
  await dialog.getByLabel('М01', { exact: true }).check()
  await dialog.getByLabel('Тип соединения', { exact: true }).selectOption('С17')
  for (const [label, value] of [['Диаметр от', '57'], ['Диаметр до', '159'], ['Толщина от', '3'], ['Толщина до', '8']]) await dialog.getByLabel(label, { exact: true }).fill(value)
  await dialog.getByRole('button', { name: 'Сохранить ТК', exact: true }).click()
  await expect(dialog).toBeHidden()
}
async function openCards(page: Page) {
  await page.goto('/welder-stamps')
  await page.getByRole('tab', { name: 'Технологические карты', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Добавить ТК', exact: true })).toBeVisible()
}

test('массовый предпросмотр: назначение, ручная замена, переименование, исключения и актуальные документы', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  // Target records must be found beyond the initial chunk even in an isolated
  // run; unrelated undated records belong to the journal but are not assigned.
  await withE2eDatabase(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint)
    select $1,'TK','TK-PAGINATION','F'||(10000+n)::text from generate_series(1,501) n`, [project]))
  const ids: number[] = []
  for (const [joint, technologyCardNumber, weldDate] of [
    ['F981', '', '2026-10-01'], ['F982', 'Ручная неизвестная', '2026-10-01'],
    ['F983', name, '2026-10-01'], ['F984', '', '2026-10-01'], ['F985', '', ''],
  ]) ids.push((await createWeldJoint({ data: { ...base, joint, technologyCardNumber, weldDate } })).id)
  const documentId = await withE2eDatabase(async db => {
    const doc = (await db.query("insert into generated_documents(type,title,file_name,mime_type,row_count) values('weldingJournal','E2E ТК документ','tk.html','text/html',1) returning id")).rows[0].id
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [doc, ids[2]])
    return doc as number
  })
  expect((await loadRemoteGeneratedDocumentRows(documentId))[0].technologyCardNumber).toBe(name)
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await openCards(page); await addCard(page)
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Изменить', exact: true }).click()
  await page.getByLabel('Название ТК', { exact: true }).fill('E2E Техкарта №12')
  await page.getByRole('button', { name: 'Сохранить ТК', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: 'Проверить и назначить ТК', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Проверка и назначение ТК' })
  await dialog.getByRole('button', { name: 'Начать проверку', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Показать стыки', exact: true }).selectOption('changes')
  await expect(dialog.getByRole('checkbox', { name: `Назначение ТК стыку ${ids[0]}`, exact: true })).toBeChecked()
  expect((await saved(ids[0])).technology_card_number).toBeFalsy()
  await expect(dialog.getByRole('row').filter({ hasText: 'F982' })).toContainText('Заменить')
  await expect(dialog.getByRole('row').filter({ hasText: 'F983' })).toContainText('Обновить название')
  await dialog.getByRole('checkbox', { name: 'Заменить', exact: true }).check()
  await dialog.getByRole('checkbox', { name: `Назначение ТК стыку ${ids[3]}`, exact: true }).uncheck()
  await page.screenshot({ path: testInfo.outputPath('tk-assignment-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(dialog.getByRole('button', { name: 'Применить выбранное (3)' })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('tk-assignment-mobile.png') })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await dialog.getByRole('button', { name: 'Применить выбранное (3)' }).click()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(calls.filter(name => name.startsWith('applyTechnologyCardAssignmentBatch'))).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Применить выбранное (3)' }).click()
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Назначено: 1 · Заменено: 1 · Названия обновлены: 1')
  for (const id of ids.slice(0, 3)) expect((await saved(id)).technology_card_number).toBe('E2E Техкарта №12')
  for (const id of ids.slice(3)) expect((await saved(id)).technology_card_number).toBeFalsy()
  expect((await loadRemoteGeneratedDocumentRows(documentId))[0].technologyCardNumber).toBe('E2E Техкарта №12')
  expect((await saved(ids[0])).welding_electrodes).toBe(base.weldingElectrodes)
  await dialog.getByRole('button', { name: 'Проверить заново', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Показать стыки', exact: true }).selectOption('unchanged')
  await expect(dialog.getByRole('row').filter({ hasText: 'F983' })).toContainText('Без изменений')
  expect(calls.filter(name => name.startsWith('previewTechnologyCardAssignments'))).toHaveLength(2)
  const detailCalls = calls.filter(name => name.startsWith('getTechnologyCardAssignmentDetails')).length
  expect(detailCalls).toBeGreaterThanOrEqual(2)
  expect(detailCalls).toBeLessThanOrEqual(4) // initial chunk + at most one filtered jump per preview
  expect(calls.filter(name => name.startsWith('applyTechnologyCardAssignmentBatch'))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('упрощённый фильтр ТК: причины пропуска раздельны, фильтр сохраняет выбор без лишних запросов', async ({ page }, testInfo) => {
  await withLineProgramFixture(db => db.query(`insert into weld_joints
    (project_title,subtitle_code,line,joint,weld_date,welding_method,connection_type,material_group,d1,d2,t1,t2)
    select $1,'TK','TK-FILTER',joint,weld_date::date,method,connection,'М01',57,159,6,3 from (values
      ('F9891',null,'РАД','С17'),
      ('F9892','2026-10-01','РАД','Т1'),
      ('F9893',null,'РАД','Т1'),
      ('F9894','2026-10-01','РАД','С17'),
      ('F9895','2026-10-01',null,'С17')
    ) fixture(joint,weld_date,method,connection)`, [project]))
  const calls: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  await openCards(page); await addCard(page)
  await page.getByRole('button', { name: 'Проверить и назначить ТК', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Проверка и назначение ТК' })
  await dialog.getByRole('button', { name: 'Начать проверку', exact: true }).click()
  const filter = dialog.getByRole('combobox', { name: 'Показать стыки', exact: true })
  await expect(filter.locator('option')).toHaveText(['Все', 'Предлагаемые изменения', 'Требуют внимания', 'Без изменений', 'Пропущены'])
  await expect(dialog.getByRole('row').filter({ hasText: 'F9894' })).toContainText('Назначить')
  const apply = dialog.getByRole('button', { name: /^Применить выбранное/ })
  await expect(apply).toBeEnabled()
  const selection = await apply.textContent()
  await page.waitForLoadState('networkidle')
  const detailsBefore = calls.filter(name => name.startsWith('getTechnologyCardAssignmentDetails')).length
  await filter.selectOption('excluded')
  const undated = dialog.getByRole('row').filter({ hasText: 'F9891' })
  const tee = dialog.getByRole('row').filter({ hasText: 'F9892' })
  const both = dialog.getByRole('row').filter({ hasText: 'F9893' })
  await expect(undated).toContainText('Нет даты сварки')
  await expect(undated).not.toContainText('Т-соединений')
  await expect(tee).toContainText('Подбор ТК для Т-соединений пока не поддерживается')
  await expect(tee).not.toContainText('Нет даты сварки')
  await expect(both).toContainText('Нет даты сварки')
  await expect(both).toContainText('Подбор ТК для Т-соединений пока не поддерживается')
  await expect(dialog.getByRole('row').filter({ hasText: 'F9894' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('tk-skip-reasons.png') })
  await filter.selectOption('attention')
  await expect(dialog.getByRole('row').filter({ hasText: 'F9895' })).toContainText('Укажите способ сварки')
  await expect(dialog.getByRole('row').filter({ hasText: 'F9892' })).toHaveCount(0)
  await filter.selectOption('changes')
  await expect(dialog.getByRole('row').filter({ hasText: 'F9894' }).getByRole('checkbox')).toBeChecked()
  await expect(apply).toHaveText(selection!)
  expect(calls.filter(name => name.startsWith('getTechnologyCardAssignmentDetails'))).toHaveLength(detailsBefore)
  expect(calls.filter(name => name.startsWith('applyTechnologyCardAssignmentBatch'))).toHaveLength(0)
})

test('массовое назначение отклоняет стык, измененный после предпросмотра', async ({ page }) => {
  const row = await createWeldJoint({ data: { ...base, joint: 'F986', weldDate: '2026-10-01' } })
  await openCards(page); await addCard(page)
  await page.getByRole('button', { name: 'Проверить и назначить ТК', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Проверка и назначение ТК' })
  await dialog.getByRole('button', { name: 'Начать проверку', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Показать стыки', exact: true }).selectOption('changes')
  await expect(dialog.getByRole('checkbox', { name: `Назначение ТК стыку ${row.id}`, exact: true })).toBeChecked()
  // Another operator's completed save after the preview, not a timestamp-only simulation.
  await updateWeldJoint({ data: { ...row, expectedVersion: (await saved(row.id)).version, technologyCardNumber: 'Другой оператор', mutationScope: 'welding' } })
  await dialog.getByRole('button', { name: 'Применить выбранное (1)' }).click()
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Стыки в этой порции изменились')
  expect((await saved(row.id)).technology_card_number).toBe('Другой оператор')
})

test('два пользователя: возврат обновляет диспетчер, сохраняет черновик и не запускает лишний пересчет', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const row = await createWeldJoint({ data: { ...base, joint: 'F987', weldDate: '2026-10-01' } })
  await changeCard({ action: 'create', card: parameters })
  await ensureDispatcherTaskIndexFresh()
  await page.goto('/journal')
  const panel = page.getByLabel('Диспетчер задач', { exact: true })
  await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
  const dispatcher = page.getByRole('dialog', { name: 'Диспетчер задач' })
  await dispatcher.getByLabel('Правила диспетчера', { exact: true }).getByRole('button', { name: /ДЗ-06/ }).click()
  await dispatcher.getByLabel('Поиск задач диспетчера', { exact: true }).fill('F987')
  await dispatcher.getByLabel('Поиск задач диспетчера', { exact: true }).press('Enter')
  await expect(dispatcher.getByLabel('Очередь задач диспетчера')).toContainText('F987')
  await dispatcher.getByRole('button', { name: 'Закрыть диспетчер' }).click()
  await editJournalJoint(page, 'F987')
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка' }) })
  const draft = editor.getByRole('textbox', { name: 'Изометрия', exact: true })
  await draft.fill('Несохранённый черновик')
  await page.waitForLoadState('networkidle')
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  const other = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1600, height: 1000 } })
  try {
    const otherPage = await other.newPage()
    await openCards(otherPage)
    await otherPage.getByRole('button', { name: 'Проверить и назначить ТК', exact: true }).click()
    const bulk = otherPage.getByRole('dialog', { name: 'Проверка и назначение ТК' })
    await bulk.getByRole('button', { name: 'Начать проверку', exact: true }).click()
    await bulk.getByRole('button', { name: 'Применить выбранное (1)' }).click()
    await otherPage.getByRole('button', { name: 'Применить изменения', exact: true }).click()
    await expect(bulk.getByRole('status')).toContainText('Назначено: 1')
    await waitForPublishedDispatcher()
    await otherPage.waitForLoadState('networkidle')
    expect((await saved(row.id)).technology_card_number).toBe(name)
    expect(calls.filter(call => call.startsWith('getDispatcherTaskSnapshot'))).toHaveLength(0)
    await page.bringToFront()
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
    await expect.poll(() => calls.filter(call => call.startsWith('getDispatcherTaskSnapshot')).length).toBe(1)
    await page.waitForLoadState('networkidle')
    await expect(draft).toHaveValue('Несохранённый черновик')
    expect(calls.filter(call => call.startsWith('getDispatcherTaskVersion'))).toHaveLength(1)
    expect(calls.filter(call => call.startsWith('refreshDispatcherTaskSnapshot'))).toHaveLength(0)
    await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
    calls.length = 0
    await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
    await expect.poll(() => calls.filter(call => call.startsWith('getDispatcherTaskVersion')).length).toBe(1)
    await page.waitForLoadState('networkidle')
    expect(calls.filter(call => call.startsWith('getDispatcherTaskSnapshot') || call.startsWith('refreshDispatcherTaskSnapshot'))).toHaveLength(0)
    const tkButton = dispatcher.getByLabel('Правила диспетчера', { exact: true }).getByRole('button', { name: /ДЗ-06/ })
    if (await tkButton.count()) await tkButton.click()
    await expect(dispatcher.getByLabel('Очередь задач диспетчера')).not.toContainText('F987')
    expect(errors).toEqual([])
  } finally { await other.close() }
})

test('компактная ТК: стабильная высота, справка, фильтры и максимум два способа на desktop/mobile', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const snapshot = await withE2eDatabase(async db => (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0])
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  try {
    await withE2eDatabase(db => db.query("insert into app_settings(key,value) values('data-list',$1) on conflict(key) do update set value=excluded.value", [JSON.stringify({ ...DEFAULT_DATA_LIST_SETTINGS, weldingTypes: ['РАД', 'РД', 'АФ'] })]))
    const old = await createWeldJoint({ data: { ...base, joint: 'F988', weldDate: '2026-10-01', technologyCardNumber: 'Старая текстовая ТК' } })
    await openCards(page)
    await addCard(page)
    const card = await registry()
    await expect(changeCard({ action: 'create', card: { ...parameters, name: 'E2E Три способа', weldingMethods: ['РАД', 'РД', 'АФ'] } })).rejects.toThrow('не больше двух')
    await expect(withE2eDatabase(db => db.query('update technology_cards set welding_methods=$1 where id=$2', [['РАД', 'РД', 'АФ'], card.id]))).rejects.toThrow('technology_cards_methods_required')
    for (const label of ['Все карты', 'Архивные', 'Действующие']) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    }
    await page.getByLabel('Поиск технологических карт').fill('НЕСУЩЕСТВУЮЩАЯ')
    await expect(page.getByText('Технологические карты не найдены.')).toBeVisible()
    await page.getByRole('button', { name: 'Очистить поиск ТК' }).click()
    const cardRow = page.getByRole('row').filter({ hasText: name })
    await expect(cardRow).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('tk-registry.png') })
    await cardRow.getByRole('button', { name: 'Изменить', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('РД', { exact: true }).check()
    await expect(dialog.getByLabel('АФ', { exact: true })).toBeDisabled()
    await dialog.getByLabel('РАД', { exact: true }).uncheck()
    await expect(dialog.getByLabel('АФ', { exact: true })).toBeEnabled()
    await dialog.getByLabel('АФ', { exact: true }).check()
    await expect(dialog.getByLabel('РАД', { exact: true })).toBeDisabled()
    await dialog.getByLabel('М05', { exact: true }).check()
    await expect(dialog.getByLabel('М11', { exact: true })).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('tk-editor-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(dialog.getByRole('button', { name: 'Сохранить ТК', exact: true })).toBeInViewport()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('tk-editor-mobile.png') })
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect((await registry()).welding_methods).toEqual(['РАД'])
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto('/journal')
    await editJournalJoint(page, 'F988')
    await dialog.getByRole('button', { name: 'Сварочный материал и ТК', exact: true }).click()
    const field = dialog.getByTestId('technology-card-field')
    const input = field.getByRole('textbox')
    await expect(field.getByLabel('Выбрать подходящую ТК')).toBeEnabled()
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await input.scrollIntoViewIfNeeded()
      const bounds = await field.boundingBox()
      expect(bounds!.height).toBeLessThanOrEqual(74)
      const next = dialog.getByLabel('Присадочная проволока', { exact: true })
      const nextY = (await next.boundingBox())!.y
      const beforeCalls = calls.filter(value => value.startsWith('getTechnologyCardSnapshot')).length
      for (const value of ['', 'ТК', 'Неизвестная длинная ТК', name, '']) {
        await input.fill(value)
        expect((await field.boundingBox())!.height).toBe(bounds!.height)
        expect((await next.boundingBox())!.y).toBe(nextY)
      }
      await field.getByRole('button', { name: 'Подбор технологической карты' }).click()
      await expect(page.getByRole('tooltip')).toContainText('В уже заваренном стыке выберите ТК вручную')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeVisible()
      expect(calls.filter(value => value.startsWith('getTechnologyCardSnapshot')).length).toBe(beforeCalls)
      expect(await field.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`tk-weld-${width}.png`) })
    }
    await page.setViewportSize({ width: 1600, height: 1000 })
    await field.getByLabel('Выбрать подходящую ТК').selectOption(String(card.id))
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect((await saved(old.id)).technology_card_number).toBe(name)
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await withE2eDatabase(async db => {
      if (snapshot) await db.query("update app_settings set value=$1,updated_at=$2 where key='data-list'", [snapshot.value, snapshot.updated_at])
      else await db.query("delete from app_settings where key='data-list'")
    })
  }
})

test('реестр ТК: UI, история переименования, архив, подтверждение удаления и отсутствие повторных запросов', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = [], calls: string[] = []
  const pending = new Set<Request>()
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) { calls.push(rpcName(request.url())); pending.add(request) } })
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  await openCards(page)
  await addCard(page)
  const weld = await createWeldJoint({ data: { ...base, joint: 'F981', weldDate: '2026-10-01' } })
  expect((await saved(weld.id)).technology_card_number).toBe(name)
  const before = await saved(weld.id)
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Изменить', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Название ТК', { exact: true }).fill('E2E Техкарта №2')
  await page.route('**/_serverFn/**', route => rpcName(route.request().url()).startsWith('changeTechnologyCard') ? route.abort('failed') : route.continue())
  await dialog.getByRole('button', { name: 'Сохранить ТК', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('Название ТК', { exact: true })).toHaveValue('E2E Техкарта №2')
  expect(await registry()).toBeTruthy()
  await page.unroute('**/_serverFn/**')
  await dialog.getByRole('button', { name: 'Сохранить ТК', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await saved(weld.id)).toEqual(before)
  const row = page.getByRole('row').filter({ hasText: 'E2E Техкарта №2' })
  await row.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить ТК', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('уже использована')
  await row.getByRole('button', { name: 'В архив', exact: true }).click()
  await expect(row).toBeHidden()
  await page.getByRole('button', { name: 'Архивные', exact: true }).click()
  await row.getByRole('button', { name: 'Вернуть', exact: true }).click()
  await expect(row).toBeHidden()
  await page.getByRole('button', { name: 'Действующие', exact: true }).click()
  await addCard(page, 'E2E Удалить')
  const unused = page.getByRole('row').filter({ hasText: 'E2E Удалить' })
  await unused.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await registry('E2E Удалить')).toBeTruthy()
  await unused.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить ТК', exact: true }).click()
  await expect(unused).toBeHidden()
  expect(await registry('E2E Удалить')).toBeUndefined()
  // The final card deletion legitimately refreshes the index asynchronously.
  // Wait for that publication and its responses before measuring idle/focus;
  // a page's already-reached navigation networkidle state is not sufficient.
  await waitForPublishedDispatcher()
  await expect.poll(() => pending.size).toBe(0)
  const count = calls.length
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  await page.waitForTimeout(500)
  expect(calls).toHaveLength(count)
  await page.getByRole('tab', { name: 'Параметры проверки' }).click()
  await page.getByRole('tab', { name: 'Технологические карты' }).click()
  expect(calls.filter(value => value.startsWith('getTechnologyCardPage')).length).toBeLessThanOrEqual(11)
  expect(errors).toEqual([])
})

test('точное имя ТК: двойной и неразрывный пробел переживают назначение, импорт и повторное сохранение', async ({ page }) => {
  const exactName = 'E2E ТК  №12\u00a0А'
  await openCards(page)
  await addCard(page, exactName)
  const created = await createWeldJoint({ data: { ...base, joint: 'F980', weldDate: '2026-10-01' } })
  expect((await saved(created.id)).technology_card_number).toBe(exactName)
  await updateWeldJoint({ data: { id: created.id, expectedVersion: (await saved(created.id)).version, responsible: 'Без изменения ТК' } })
  expect((await saved(created.id)).technology_card_number).toBe(exactName)
  const imported = await importWeldJoints({ data: { records: [{ ...base, joint: 'F979', weldDate: '2026-10-01', technologyCardNumber: ` ${exactName} ` }] } })
  expect((await saved(imported.rows[0].id)).technology_card_number).toBe(exactName)
  for (const [mode, joint] of [['mass', 'F978'], ['replace', 'F977']] as const) {
    const row = await createWeldJoint({ data: { ...base, joint } })
    const data = { records: [{ id: row.id, weldDate: '2026-10-01' }], expectedVersions: [{ id: row.id, version: (await saved(row.id)).version }] }
    if (mode === 'mass') await massFillWeldJoints({ data })
    else await replaceWeldJoints({ data: { ...data, deleteIds: [] } })
    expect((await saved(row.id)).technology_card_number).toBe(exactName)
  }
  await page.goto('/journal')
  await editJournalJoint(page, 'F980')
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка' }) })
  await editor.getByRole('button', { name: 'Сварочный материал и ТК', exact: true }).click()
  const field = editor.getByLabel('Номер технологической карты', { exact: true })
  await expect(field).toHaveValue(exactName)
  await field.fill('')
  await editor.getByLabel('Выбрать подходящую ТК').selectOption(String((await registry(exactName)).id))
  await editor.getByLabel('Сварочные электроды', { exact: true }).fill('Правка материала; название ТК сохраняется')
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect((await saved(created.id)).technology_card_number).toBe(exactName)
  await ensureDispatcherTaskIndexFresh()
  expect(String((await virtualTasks(created.id))[0].dispatcherTasks)).not.toContain('ДЗ-06')
})

test('стык, импорт, массовое заполнение, замена и ДЗ-06: одинаковые переходы и ручное назначение старому стыку', async ({ page }) => {
  test.setTimeout(180_000)
  const old = await createWeldJoint({ data: { ...base, joint: 'F981', weldDate: '2026-10-01' } })
  expect((await saved(old.id)).technology_card_number).toBeNull()
  await openCards(page)
  await addCard(page)
  await ensureDispatcherTaskIndexFresh()
  const virtual = await virtualTasks(old.id)
  expect(String(virtual[0].dispatcherTasks)).toContain('ДЗ-06')
  const filtered = () => readJournalGrid({ columnFilters: buildDispatcherTaskServerFilters({ dispatcherTasks: 'ДЗ-06', projectTitle: project }),
    groupBy: [], route: [], start: 0, end: 100 })
  expect((await filtered()).rows.map(row => row.id)).toEqual([old.id])
  expect((await saved(old.id)).technology_card_number).toBeNull()
  await updateWeldJoint({ data: { id: old.id, expectedVersion: (await saved(old.id)).version, responsible: 'Несвязанная правка' } })
  expect((await saved(old.id)).technology_card_number).toBeNull()
  await page.goto('/journal')
  await editJournalJoint(page, 'F981')
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка' }) })
  await editor.getByRole('button', { name: 'Сварочный материал и ТК', exact: true }).click()
  await editor.getByLabel('Выбрать подходящую ТК').selectOption(String((await registry()).id))
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect((await saved(old.id)).technology_card_number).toBe(name)
  await ensureDispatcherTaskIndexFresh()
  expect(String((await virtualTasks(old.id))[0].dispatcherTasks)).not.toContain('ДЗ-06')
  expect((await filtered()).rows).toEqual([])

  const imported = await importWeldJoints({ data: { records: [{ ...base, joint: 'F982', weldDate: '2026-10-01' }] } })
  expect((await saved(imported.rows[0].id)).technology_card_number).toBe(name)
  for (const mode of ['mass', 'replace'] as const) {
    const created = await createWeldJoint({ data: { ...base, joint: mode === 'mass' ? 'F983' : 'F984' } })
    const data = { records: [{ id: created.id, weldDate: '2026-10-01' }], expectedVersions: [{ id: created.id, version: (await saved(created.id)).version }] }
    if (mode === 'mass') await massFillWeldJoints({ data })
    else await replaceWeldJoints({ data: { ...data, deleteIds: [] } })
    const stored = await saved(created.id)
    expect(stored.technology_card_number).toBe(name)
    expect(stored.welding_electrodes).toBe(base.weldingElectrodes)
  }
  const second = await changeCard({ action: 'create', card: { ...parameters, name: 'E2E Вторая' } })
  if (!('revision' in second) || typeof second.revision !== 'number' || !('name' in second) || typeof second.name !== 'string') {
    throw new Error('Создание ТК должно вернуть карту с названием и числовой версией')
  }
  const multiple = await createWeldJoint({ data: { ...base, joint: 'F985', weldDate: '2026-10-01' } })
  expect((await saved(multiple.id)).technology_card_number).toBeNull()
  await changeCard({ action: 'archive', id: second.id, expectedRevision: second.revision, archived: true })
  await ensureDispatcherTaskIndexFresh()
  expect((await saved(multiple.id)).technology_card_number).toBeNull()
  await expect(updateWeldJoint({ data: { id: multiple.id, expectedVersion: (await saved(multiple.id)).version, technologyCardNumber: second.name,
    technologyCardSelection: { id: second.id, revision: second.revision } } })).rejects.toThrow('уже изменена или архивирована')
  const mismatch = await createWeldJoint({ data: { ...base, joint: 'F986', weldDate: '2026-10-01', technologyCardNumber: name, d1: 219, d2: 325 } })
  expect((await saved(mismatch.id)).technology_card_number).toBe(name)
  await ensureDispatcherTaskIndexFresh()
  expect(String((await virtualTasks(mismatch.id))[0].dispatcherTasks)).toContain('ДЗ-06')
})

test('выключение ДЗ-06 через настройки не отключает подбор; повторное включение возвращает старые задачи', async ({ page }) => {
  const snapshot = await withE2eDatabase(async db => (await db.query("select value,updated_at from app_settings where key='dispatcher'")).rows[0])
  try {
    const old = await createWeldJoint({ data: { ...base, joint: 'F981', weldDate: '2026-10-01' } })
    await openCards(page)
    await addCard(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Правила и проверки', exact: true }).click()
    await page.getByRole('tab', { name: 'Задачи диспетчера', exact: true }).click()
    const toggle = page.locator('#dispatcher-setting-check-technology-card input[type="checkbox"]')
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    const state = () => withE2eDatabase(async db => JSON.parse((await db.query("select value from app_settings where key='dispatcher'")).rows[0]?.value ?? '{}')['check-technology-card'])
    await expect.poll(state).toBe(false)
    await ensureDispatcherTaskIndexFresh()
    expect(String((await virtualTasks(old.id))[0].dispatcherTasks)).not.toContain('ДЗ-06')
    const fresh = await createWeldJoint({ data: { ...base, joint: 'F982', weldDate: '2026-10-01' } })
    expect((await saved(fresh.id)).technology_card_number).toBe(name)
    expect((await saved(old.id)).technology_card_number).toBeNull()
    await toggle.click()
    await expect.poll(state).toBe(true)
    await ensureDispatcherTaskIndexFresh()
    expect(String((await virtualTasks(old.id))[0].dispatcherTasks)).toContain('ДЗ-06')
    expect((await saved(old.id)).technology_card_number).toBeNull()
  } finally {
    await page.close()
    await withE2eDatabase(async db => {
      if (snapshot) await db.query("update app_settings set value=$1,updated_at=$2 where key='dispatcher'", [snapshot.value, snapshot.updated_at])
      else await db.query("delete from app_settings where key='dispatcher'")
      await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
    })
  }
})
