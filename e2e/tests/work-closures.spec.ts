import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { asE2eOwner } from '../with-owner-access'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { expect, test, type Page } from '@playwright/test'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { editJournalJoint, journalRow, selectJournalJoint } from '../journal-grid'
import { withE2eDatabase } from '../database'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import { ALL_JOURNAL_OUTPUT_HEADERS, showAllJournalOutputColumns } from '../report-output-contract'
import type { WorkClosureChange } from '../../src/lib/work-closures'
import { buildDerivedCalculationCacheKey } from '../../src/lib/derived-calculation-cache-key'
import { STATISTICS_CACHE_NAMESPACE } from '../../src/lib/statistics-result-version'

const closureIds = { 'Вид работ': 'workClosureSummary', 'Код работ': 'workClosureRateCode', 'КС3': 'workClosureActNumber' } as const
type ClosureHeader = keyof typeof closureIds
// Closure columns are the last group in a fresh journal view.
async function revealClosureColumn(page: Page, id: typeof closureIds[ClosureHeader]) {
  const grid = page.locator('[data-welding-journal-grid]')
  const header = grid.locator('.ag-header-cell[col-id="' + id + '"]')
  await expect.poll(async () => {
    if (await header.isVisible()) return true
    await grid.locator('.ag-grid-viewport').evaluate(element => { element.scrollLeft = element.scrollWidth })
    return header.isVisible()
  }).toBe(true)
  await header.scrollIntoViewIfNeeded()
}

async function openClosureFilter(page: Page, label: ClosureHeader) {
  const id = closureIds[label]
  await revealClosureColumn(page, id)
  await page.locator('.ag-header-cell[col-id="' + id + '"] .ag-header-cell-filter-button').click()
  return page.getByRole('dialog', { name: 'Фильтр: ' + label, exact: true })
}
async function chooseClosureFilter(page: Page, label: ClosureHeader, values: string[]) {
  const filter = await openClosureFilter(page, label)
  for (const value of values) await filter.getByRole('checkbox', { name: value, exact: true }).check()
  await filter.getByRole('button', { name: 'Применить' }).click()
}

const project = 'E2E Closure Flow'
test.afterEach(async ({ page }) => { await page.close(); await cleanupLineProgramProjects([project]) })

test('группа закрытия работ доступна в настройке столбцов только сварочного журнала', async ({ page }) => {
  for (const path of ['/journal', '/lnk', '/psto']) {
    await page.goto(path)
    await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    const view = page.getByRole('dialog')
    await expect(view.getByRole('tab', { name: 'Столбцы', exact: true })).toBeVisible()
    await expect(view.getByText('Закрытие работ', { exact: true })).toHaveCount(path === '/journal' ? 1 : 0)
  }
})

test('испытание из настроек появляется под своим названием в карточке, ПКМ и фильтре', async ({ page }) => {
  const name = 'ПРОВЕРКА НА ГЕРМЕТИЧНОСТЬ'
  const original = await withE2eDatabase(async db => (await db.query("select value, updated_at from app_settings where key='data-list'")).rows[0])
  const ids = await withLineProgramFixture(async db => {
    const { rows } = await db.query<{id: number}>("insert into weld_joints(project_title,line,joint) values($1,'L','F901'),($1,'L','F902') returning id", [project])
    await db.query("insert into work_closures(weld_joint_id, work_type) values($1,'Старая работа')", [rows[1].id])
    return rows.map(row => row.id)
  })
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Данные', exact: true }).click()
    const settings = page.getByRole('region', { name: 'Вид испытаний', exact: true })
    await settings.getByLabel('Новое значение').fill(name)
    await settings.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(settings.getByText(name, { exact: true })).toBeVisible()
    await page.goto('/journal')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
    for (const id of ids) await selectJournalJoint(page, id)
    await journalRow(page, ids[0]).locator('[col-id="joint"]').click({ button: 'right' })
    await page.getByRole('button', { name: 'Закрытие работ', exact: true }).hover()
    await page.getByRole('button', { name: 'Назначить расценки', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Закрытие работ', exact: true })
    const select = dialog.getByRole('combobox', { name: 'Вид работы', exact: true })
    await expect(select.locator('optgroup[label="Испытания"] option').filter({ hasText: name })).toHaveText(name)
    await expect(select.locator('option[value="Старая работа"]')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await revealClosureColumn(page, 'workClosureSummary')
    await journalRow(page, ids[0]).getByRole('button', { name: 'Закрытие работ · F901' }).click()
    await dialog.getByRole('button', { name: 'Добавить работу' }).click()
    await select.selectOption({ label: name })
    await dialog.getByLabel('Код работ', { exact: true }).fill('RATE-901')
    await dialog.getByRole('button', { name: 'Сохранить закрытия' }).click()
    await expect(dialog.getByRole('status')).toContainText('Сохранено позиций: 1')
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await revealClosureColumn(page, 'workClosureSummary')
    await page.locator('.ag-header-cell[col-id="workClosureSummary"] .ag-header-cell-filter-button').click()
    const filter = page.getByRole('dialog', { name: 'Фильтр: Вид работ' })
    await expect(filter.getByRole('checkbox', { name: 'Старая работа' })).toBeVisible()
    await filter.getByRole('checkbox', { name, exact: true }).check()
    await filter.getByRole('button', { name: 'Применить' }).click()
    await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
    await expect(journalRow(page, ids[0])).toContainText('F901')
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Данные', exact: true }).click()
    await settings.getByRole('button', { name: 'Удалить ' + name, exact: true }).click()
    await expect(page.getByText('Нельзя удалить вид испытаний «' + name + '»: он используется в закрытии работ.', { exact: true })).toBeVisible()
  } finally {
    await withE2eDatabase(db => original
      ? db.query("update app_settings set value=$1, updated_at=$2 where key='data-list'", [original.value, original.updated_at])
      : db.query("delete from app_settings where key='data-list'"))
  }
})

test('закрытия по двум стыкам, независимые КС3, фильтр по одной работе и история изменений', async ({ page }) => {
  test.setTimeout(120_000)
  const ids = await withLineProgramFixture(async client => {
    const joints = (await client.query<{ id: number }>(
      "insert into weld_joints(project_title,subtitle_code,line,joint,connection_type,pre_heat_treatment_required,psto_required) values($1,'CODE','LINE','F001','СШ',true,'отменен'),($1,'CODE','LINE','F002','СШ',true,'да'),($1,'CODE','LINE','F003','СШ',false,null) returning id", [project])).rows
    await client.query("insert into work_closures(weld_joint_id,work_type) values($1,'РК')", [joints[2].id])
    await client.query("insert into work_closures(weld_joint_id,work_type,rate_code,act_number) values($1,'ПСТО','WELD','00059')", [joints[2].id])
    return joints.slice(0, 2).map(row => row.id)
  })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText('Найдено: 3', { exact: true })).toBeVisible()
  for (const id of ids) await selectJournalJoint(page, id)
  await journalRow(page, ids[0]).locator('[col-id="joint"]').click({ button: 'right' })
  const menu = page.getByTestId('context-action-menu')
  await expect(menu.getByRole('button', { name: 'Редактировать стык' })).toBeVisible()
  const commands = await menu.locator('[data-menu-label]').allTextContents()
  const edit = commands.indexOf('Редактировать стык')
  expect(edit).toBeGreaterThanOrEqual(0)
  expect(commands[edit + 1]).toBe('Закрытие работ')
  expect(commands.slice(-2)).toEqual(['Копировать выделенные ячейки', 'Удалить выбранные (2)'])
  await menu.getByRole('button', { name: 'Закрытие работ', exact: true }).hover()
  await page.getByRole('button', { name: 'Назначить расценки', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Закрытие работ', exact: true })
  await expect(dialog.locator('select optgroup option')).toHaveCount(13)
  await expect(dialog.locator('option[value="ВИК до ТО"]')).toHaveCount(1)
  await expect(dialog.locator('option[value="ВИК"]')).toHaveCount(1)
  await expect(dialog.locator('select optgroup').last()).toHaveAttribute('label', 'НК до ТО')
  await expect(dialog.getByText('Выбрано стыков: 2', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/Стыки для этой работы/)).toHaveCount(0)
  await dialog.getByLabel('Вид работы', { exact: true }).selectOption('РК')
  await dialog.getByLabel('Код работ', { exact: true }).fill('ABC33-01231')
  await expect(dialog.getByText('Позиций к сохранению: 2 · стыков: 2')).toBeVisible()
  await dialog.getByRole('button', { name: 'Добавить работу' }).click()
  await dialog.getByLabel('Вид работы', { exact: true }).last().selectOption('РК до ТО')
  await dialog.getByLabel('Код работ', { exact: true }).last().fill('PRE')
  await expect(dialog.getByText('НК до ТО доступен для 1 из 2 выбранных стыков.')).toBeVisible()
  await expect(dialog.getByText('Позиций к сохранению: 3 · стыков: 2')).toBeVisible()
  await dialog.getByRole('button', { name: 'Сохранить закрытия' }).click()
  await expect(dialog).toBeHidden()
  await withE2eDatabase(async db => {
    expect((await db.query("select weld_joint_id from work_closures where weld_joint_id=any($1::int[]) and work_type='РК до ТО'", [ids])).rows)
      .toEqual([{ weld_joint_id: ids[1] }])
    // Later disabling the stage must preserve the saved position, including its label.
    await db.query('update weld_joints set pre_heat_treatment_required=false where id=$1', [ids[1]])
  })
  await revealClosureColumn(page, 'workClosureSummary')
  await journalRow(page, ids[0]).getByRole('button', { name: 'Закрытие работ · F001' }).click()
  await expect(dialog.getByLabel('Вид работы', { exact: true })).toHaveValue('РК')
  await expect(dialog.locator('select optgroup option')).toHaveCount(9)
  await expect(dialog.locator('option[value="ВИК до ТО"]')).toHaveCount(0)
  await dialog.getByLabel('КС3', { exact: true }).fill('58')
  await dialog.getByRole('button', { name: 'Добавить работу' }).click()
  await dialog.getByLabel('Вид работы', { exact: true }).last().selectOption('Сварка')
  await dialog.getByLabel('Код работ', { exact: true }).last().click()
  await dialog.getByRole('listbox', { name: 'Сохранённые коды работ' }).getByRole('option', { name: 'WELD' }).click()
  await dialog.getByRole('button', { name: 'Сохранить закрытия' }).click()
  await expect(dialog.getByRole('status')).toContainText('Сохранено позиций: 2')
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await journalRow(page, ids[0]).locator('[col-id="joint"]').click({ button: 'right' })
  await page.getByRole('button', { name: 'Закрытие работ', exact: true }).hover()
  await page.getByRole('button', { name: 'Указать КС3', exact: true }).click()
  await dialog.getByLabel('Номер КС3').click()
  await dialog.getByRole('listbox', { name: 'Сохранённые номера КС3' }).getByRole('option', { name: '00059' }).click()
  await dialog.getByLabel('Вид работы', { exact: true }).selectOption('ПИ')
  await dialog.getByLabel('Код работ', { exact: true }).fill('PI-100')
  await dialog.getByRole('button', { name: 'Сохранить закрытия' }).click()
  await expect(dialog).toBeHidden()
  const workFilter = await openClosureFilter(page, 'Вид работ')
  const orderedTypes = ['Сварка', 'РК', 'ПСТО', 'ПИ', 'РК до ТО']
  await expect(workFilter.locator('.journal-filter-option input')).toHaveCount(orderedTypes.length + 1)
  expect(await workFilter.locator('.journal-filter-option input').evaluateAll(inputs => inputs.map(input => input.getAttribute('aria-label')))).toEqual(['Без записей о закрытии', ...orderedTypes])
  await workFilter.getByRole('button', { name: 'Сводка', exact: true }).click()
  const summary = page.getByRole('dialog', { name: 'Сводка по видам работ' })
  await expect(summary.getByRole('rowheader')).toHaveText(orderedTypes.map(type => type + ' · всего'))
  await summary.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await chooseClosureFilter(page, 'Код работ', ['ABC33-01231'])
  await chooseClosureFilter(page, 'КС3', ['58'])
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(journalRow(page, ids[0])).toContainText('F001')
  const act = await openClosureFilter(page, 'КС3')
  await act.getByRole('button', { name: 'Сбросить фильтр' }).click()
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  const rates = await openClosureFilter(page, 'Код работ')
  await rates.getByLabel('Найти значение фильтра').fill('любой заполненный')
  await rates.getByRole('button', { name: 'Выбрать найденные' }).click()
  await expect(rates.getByLabel('Любой заполненный код', { exact: true })).toBeChecked()
  await rates.getByLabel('Найти значение фильтра').fill('')
  await expect(rates.getByRole('checkbox', { name: 'ABC33-01231', exact: true })).not.toBeChecked()
  await rates.getByRole('button', { name: 'Применить' }).click()
  await chooseClosureFilter(page, 'Вид работ', ['РК'])
  await chooseClosureFilter(page, 'КС3', ['Без КС3'])
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(journalRow(page, ids[1]).locator('[col-id="joint"]')).toContainText('F002')
  await journalRow(page, ids[1]).getByRole('checkbox').uncheck()
  await editJournalJoint(page, ids[1])
  await page.getByRole('button', { name: 'Закрытие работ', exact: true }).click()
  const card = page.getByRole('region', { name: 'Позиции закрытия работ' })
  const types = card.getByLabel('Вид работы', { exact: true })
  await expect(types).toHaveCount(3)
  expect(await types.evaluateAll(selects => selects.map(select => (select as HTMLSelectElement).value))).toEqual(['РК', 'ПИ', 'РК до ТО'])
  await expect(types.nth(0).locator('option[value="РК до ТО"]')).toHaveCount(0)
  await expect(types.nth(2).locator('optgroup[label="Ранее сохранённые"] option')).toHaveText('РК до ТО')
  await expect(card.getByLabel('КС3', { exact: true }).nth(1)).toHaveValue('00059')
  await expect(card.getByLabel('Код работ', { exact: true }).nth(1)).toHaveValue('PI-100')
  const rate = card.getByRole('combobox', { name: 'Код работ', exact: true }).first()
  await expect(rate).toHaveValue('ABC33-01231')
  await rate.fill('RK-2')
  await card.getByRole('button', { name: 'Сохранить закрытия' }).click()
  await expect(card.getByRole('status')).toContainText('Сохранено позиций: 1')
  const entries = await withE2eDatabase(async db => (await db.query(`select o.action, o.actor_name, c.joint_id, c.area, c.changes
    from audit_changes c join audit_operations o on o.id=c.operation_id
    where c.entity='work_closures' and c.joint_id=any($1::int[])`, [ids])).rows)
  expect(entries.filter(entry => entry.action === 'saveBulkWorkClosures')).toHaveLength(5)
  expect(entries).toContainEqual(expect.objectContaining({ joint_id: ids[1], area: 'closures', actor_name: 'Владелец E2E',
    changes: expect.objectContaining({ rateCode: { before: 'ABC33-01231', after: 'RK-2', origin: 'user' } }) }))
  await page.goto('/activity?jointId=' + ids[1])
  const event = page.getByRole('row').filter({ hasText: 'Закрытие работ в карточке' })
  await event.getByRole('button', { name: 'Подробности' }).click()
  const detail = page.getByRole('table', { name: 'Изменения записи' }).getByRole('row').filter({ hasText: 'Код работ' })
  await expect(detail).toContainText('ABC33-01231')
  await expect(detail).toContainText('RK-2')
})

test('конкурирующие закрытия сохраняются атомарно, повтор запроса не дублирует историю', async ({ page, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Проверяет опубликованные имена RPC в локальной сборке')
  const ids = await withLineProgramFixture(async client => (await client.query<{id: number}>(
    "insert into weld_joints(project_title,joint) values($1,'F011'),($1,'F012') returning id", [project])).rows.map(row => row.id))
  let endpoint = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) endpoint = request.url() })
  await page.goto('/account?tab=profile')
  await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
  const save = async (operation: string, changes: WorkClosureChange[], overwriteExisting?: boolean) => {
    const response = await page.request.post(siblingRpcUrl(endpoint, operation + '_createServerFn_handler'), {
      data: await serializeRpcData({ changes, ...(overwriteExisting === undefined ? {} : { overwriteExisting }) }), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    return await deserializeRpcResponse(await response.text()) as { result?: { count: number }; error?: unknown }
  }
  const workType = 'Сварка'
  const change = (weldJointId: number, rateCode: string): WorkClosureChange => ({
    weldJointId, workType, before: null, after: { workType, rateCode, actNumber: '' },
  })
  const invented = 'Название вне списка'
  expect((await save('saveJointWorkClosures', [{ weldJointId: ids[0], workType: invented, before: null,
    after: { workType: invented, rateCode: 'A', actNumber: '' } }])).error).toBeDefined()
  const unavailable = { weldJointId: ids[1], workType: 'РК до ТО', before: null, after: { workType: 'РК до ТО', rateCode: 'B', actNumber: '' } }
  expect((await save('saveJointWorkClosures', [unavailable])).error).toBeDefined()
  expect((await save('saveBulkWorkClosures', [change(ids[0], 'A'), unavailable])).error).toBeDefined()
  const freshStats = buildDerivedCalculationCacheKey(STATISTICS_CACHE_NAMESPACE, project)
  const staleStats = buildDerivedCalculationCacheKey(STATISTICS_CACHE_NAMESPACE, project + '-stale')
  const report = buildDerivedCalculationCacheKey('report-summary', project)
  const cacheKeys = [freshStats, staleStats, report]
  await withE2eDatabase(db => db.query(`insert into derived_calculation_cache(cache_key,source_revision,payload)
    select entry.key,state.source_revision - (entry.key = $2)::int,'{}'
    from unnest($1::text[]) entry(key) cross join derived_calculation_state state where state.id=1`, [cacheKeys, staleStats]))
  const requests = ['A', 'B'].map(rate => ids.map(id => change(id, rate)))
  const results = await Promise.all(requests.map(batch => save('saveBulkWorkClosures', batch)))
  const winner = results.findIndex(result => result.result?.count === 2)
  expect(winner).toBeGreaterThanOrEqual(0)
  expect(results[1 - winner].error).toBeDefined()
  const cache = await withE2eDatabase(db => db.query(`select cache_key, cache.source_revision = state.source_revision as current
    from derived_calculation_cache cache cross join derived_calculation_state state where state.id=1 and cache_key=any($1::text[])`, [cacheKeys]))
  expect(cache.rows).toEqual([{ cache_key: freshStats, current: true }])
  expect((await save('saveBulkWorkClosures', requests[winner])).result?.count).toBe(0)
  const rows = () => withE2eDatabase(async db => (await db.query(
    'select rate_code from work_closures where weld_joint_id=any($1::int[]) order by weld_joint_id', [ids])).rows)
  expect(await rows()).toEqual(ids.map(() => ({ rate_code: requests[winner][0].after!.rateCode })))
  const before = requests[winner][1].after
  expect((await save('saveJointWorkClosures', [{ weldJointId: ids[1], workType, before, after: null }])).result?.count).toBe(1)
  const stale = [change(ids[1], 'C'), change(ids[0], 'C')]
  expect((await save('saveBulkWorkClosures', stale)).error).toBeDefined()
  const replacements = requests[winner].map(item => ({ ...item, before: item.after, after: { workType, rateCode: 'C', actNumber: '02' } }))
  const first = replacements[0]
  expect((await save('saveBulkWorkClosures', [first])).error).toBeDefined()
  expect((await save('saveBulkWorkClosures', [{ ...first, after: null }], true)).error).toBeDefined()
  expect((await save('saveBulkWorkClosures', [{ ...first, after: { ...first.after, rateCode: '' } }], true)).error).toBeDefined()
  expect((await save('saveBulkWorkClosures', replacements, true)).error).toBeDefined()
  expect(await rows()).toEqual([{ rate_code: first.before!.rateCode }])
  expect((await save('saveBulkWorkClosures', [first], true)).result?.count).toBe(1)
  expect((await save('saveBulkWorkClosures', [first], true)).result?.count).toBe(0)
  const history = await withE2eDatabase(async db => (await db.query(
    "select kind from audit_changes where entity='work_closures' and joint_id=any($1::int[]) order by id", [ids])).rows)
  expect(history.map(row => row.kind)).toEqual(['create', 'create', 'delete', 'update'])
})

test('сметчик работает из журнала с отдельными правами просмотра и изменения', async ({ browser, baseURL }) => {
  const email = 'closure-' + randomUUID() + '@e2e.test'
  const password = randomUUID()
  const [id, secondId] = await withLineProgramFixture(async db => {
    const joints = (await db.query<{id: number}>("insert into weld_joints(project_title,line,joint) values($1,'CLOSURE','F811'),($1,'CLOSURE','F812') returning id", [project])).rows
    await db.query("insert into work_closures(weld_joint_id,work_type,rate_code) values($1,'ВИК','R-811')", [joints[0].id])
    return joints.map(row => row.id)
  })
  await resetE2eAccountFixtureLimits()
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Сметчик E2E', email, title: '', role: 'user', permissions: ['welding.view', 'closures.view', 'closures.edit'] })
    await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password })
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    const open = async () => {
      await page.goto('/journal')
      await revealClosureColumn(page, 'workClosureSummary')
      await journalRow(page, id).getByRole('button', { name: 'Закрытие работ · F811' }).click()
      await expect(page.getByLabel('Код работ', { exact: true })).toHaveValue('R-811')
    }
    await open()
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    await selectJournalJoint(page, id)
    await selectJournalJoint(page, secondId)
    await journalRow(page, id).locator('[col-id="joint"]').click({ button: 'right' })
    await page.getByRole('button', { name: 'Закрытие работ', exact: true }).hover()
    await page.getByRole('button', { name: 'Указать КС3', exact: true }).click()
    await page.getByLabel('Номер КС3').fill('КС-47')
    await page.getByLabel('Вид работы', { exact: true }).selectOption('ВИК')
    await page.getByRole('button', { name: 'Сохранить закрытия' }).click()
    await expect(page.getByRole('dialog', { name: 'Закрытие работ', exact: true })).toBeHidden()
    await open()
    await expect(page.getByLabel('КС3', { exact: true })).toHaveValue('КС-47')
    await page.getByLabel('КС3', { exact: true }).fill('КС-48')
    await page.getByRole('button', { name: 'Сохранить закрытия' }).click()
    await expect(page.getByRole('status').filter({hasText: 'Сохранено позиций: 1'})).toBeVisible()
    const permissions = async (next: string[]) => withE2eDatabase(db => db.query(
      'update auth_users set permissions=$1::jsonb, revision=revision+1 where email=$2', [JSON.stringify(next), email]))
    await permissions(['welding.view', 'closures.view'])
    await open()
    await expect(page.getByLabel('КС3', { exact: true })).toHaveValue('КС-48')
    await expect(page.getByRole('button', { name: 'Сохранить закрытия' })).toHaveCount(0)
    await permissions(['welding.view', 'welding.edit', 'history.joint', 'history.view'])
    await page.goto('/journal')
    await page.getByRole('button', {name: 'Настроить вид', exact: true}).click()
    await expect(page.getByRole('dialog').getByText('Закрытие работ', {exact: true})).toHaveCount(0)
    await page.goto('/activity?jointId=' + id)
    await expect(page.getByRole('heading', { name: 'История стыка · ID ' + id })).toBeVisible()
    await expect(page.getByText('Закрытие работ в карточке', { exact: true })).toHaveCount(0)
  } finally {
    await context.close()
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})

test('закрытый фильтр не запрашивает значения при поиске, повторное открытие учитывает новую область', async ({ page }) => {
  await withLineProgramFixture(async db => {
    const { rows } = await db.query<{ id: number }>("insert into weld_joints(project_title,line,joint) values($1,'FACET-ONE','F901'),($1,'FACET-TWO','F902') returning id", [project])
    await db.query("insert into work_closures(weld_joint_id,work_type,rate_code) values($1,'Сварка','CODE-ONE'),($2,'Сварка','CODE-TWO')", rows.map(row => row.id))
  })
  const requests: string[] = []
  page.on('request', request => {
    if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('readWorkClosureFacet')) requests.push(request.url())
  })
  await page.goto('/journal')
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  await search.fill(project)
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  const filter = await openClosureFilter(page, 'Код работ')
  await expect(filter.getByRole('checkbox', { name: 'CODE-TWO' })).toBeVisible()
  await filter.getByRole('button', { name: 'Закрыть фильтр' }).click()
  expect(requests).toHaveLength(1)
  await search.fill('FACET-ONE')
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
  const reopened = await openClosureFilter(page, 'Код работ')
  await expect(reopened.getByRole('checkbox', { name: 'CODE-ONE' })).toBeVisible()
  await expect(reopened.getByRole('checkbox', { name: 'CODE-TWO' })).toHaveCount(0)
  expect(requests).toHaveLength(2)
})

test('множественный фильтр и сводка считают позиции выбранных актов и открывают нужные стыки', async ({ page }) => {
  const ids = await withLineProgramFixture(async db => {
    const { rows } = await db.query<{ id: number }>("insert into weld_joints(project_title,line,joint) values($1,'ACT-LINE','F021'),($1,'ACT-LINE','F022'),($1,'ACT-LINE','F023'),($1,'OTHER','F024') returning id", [project])
    const ids = rows.map(row => row.id)
    await db.query(`insert into work_closures(weld_joint_id,work_type,rate_code,act_number) values
      ($1,'Сварка','A','01'),($2,'Сварка','A','01'),($2,'РК','B','02'),($3,'РК','','01'),
      ($3,'ВИК','A','01'),($3,'Сварка','A','03'),($4,'Сварка','A','01')`, ids)
    return ids
  })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('ACT-LINE')
  await expect(page.getByText('Найдено: 3', { exact: true })).toBeVisible()
  await revealClosureColumn(page, 'workClosureSummary')
  await revealClosureColumn(page, 'workClosureActNumber')
  const row = journalRow(page, ids[2])
  const cell = (field: ClosureHeader) => row.locator('[col-id="' + closureIds[field] + '"] button')
  await expect(cell('Вид работ')).toContainText('1. Сварка')
  await expect(cell('Код работ')).toContainText('1. A')
  await expect(cell('КС3')).toContainText('1. 03')
  await expect(cell('Код работ')).toContainText('3. —')
  const allRates = await openClosureFilter(page, 'Код работ')
  const rateChoices = allRates.locator('.journal-filter-values .journal-filter-option')
  await expect(rateChoices.nth(0)).toHaveText('Любой заполненный код3')
  await expect(rateChoices.nth(1)).toHaveText('Без кода1')
  await allRates.getByRole('button', { name: 'Закрыть фильтр' }).click()
  await chooseClosureFilter(page, 'Вид работ', ['Сварка'])
  await expect(cell('Вид работ')).toHaveText('Сварка')
  const rates = await openClosureFilter(page, 'Код работ')
  await expect(rates.getByRole('checkbox', { name: 'B', exact: true })).toHaveCount(0)
  await expect(rates.getByRole('checkbox', { name: 'A', exact: true }).locator('..').locator('.journal-count')).toHaveText('3')
  await rates.getByRole('button', { name: 'Закрыть фильтр' }).click()
  await chooseClosureFilter(page, 'Вид работ', ['РК'])
  await chooseClosureFilter(page, 'Код работ', ['A', 'B'])
  await chooseClosureFilter(page, 'КС3', ['01', '02'])
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  for (const [field, title] of [['Вид работ', 'Сводка по видам работ'], ['Код работ', 'Сводка по кодам работ']] as const) {
    const filter = await openClosureFilter(page, field)
    await filter.getByRole('button', { name: 'Сводка', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: title })
    await expect(dialog.getByRole('row')).toHaveCount(5)
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
  }
  const acts = await openClosureFilter(page, 'КС3')
  await acts.getByRole('button', { name: 'Сводка', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Сводка по КС3' })
  const open = (act: string, work: string, code: string) => dialog.getByRole('button', { name: ['Показать стыки', act, work, code].join(' · ') })
  await expect(dialog.getByRole('row')).toHaveCount(5)
  await expect(open('01', 'Сварка', 'A')).toHaveText('2')
  await expect(open('02', 'РК', 'B')).toHaveText('1')
  await open('02', 'РК', 'B').click()
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(journalRow(page, ids[1])).toContainText('F022')
  for (const label of ['Вид работ', 'Код работ', 'КС3'] as const) {
    const filter = await openClosureFilter(page, label)
    await filter.getByRole('button', { name: 'Сбросить фильтр' }).click()
  }
  await expect(page.getByText('Найдено: 3', { exact: true })).toBeVisible()
  await chooseClosureFilter(page, 'КС3', ['01'])
  await (await openClosureFilter(page, 'КС3')).getByRole('button', { name: 'Сводка', exact: true }).click()
  await expect(open('01', 'РК', 'Без кода')).toHaveText('1')
  await open('01', 'РК', 'Без кода').click()
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(journalRow(page, ids[2])).toContainText('F023')
  const filteredRates = await openClosureFilter(page, 'Код работ')
  await expect(filteredRates.getByLabel('Любой заполненный код', { exact: true }).locator('..').locator('.journal-count')).toHaveText('0')
  await expect(filteredRates.getByLabel('Без кода', { exact: true }).locator('..').locator('.journal-count')).toHaveText('1')
})

test('четыре работы и длинные коды занимают одну строку обычной высоты, сводка считает стык один раз', async ({ page }, info) => {
  const code = '113, 2. ' + 'Р-0123456789-'.repeat(100)
  const ids = await withLineProgramFixture(async db => {
    const { rows } = await db.query<{ id: number }>("insert into weld_joints(project_title,line,joint) values($1,'SUMMARY','F041'),($1,'SUMMARY','F042'),($1,'SUMMARY','F043') returning id", [project])
    await db.query("insert into work_closures(weld_joint_id,work_type,rate_code,act_number) values($1,'Сварка',$3,''),($1,'ВИК',$3,'17'),($1,'ТВМТ','','18'),($1,'ГИ','','19'),($2,'Сварка',$3,'')", [rows[0].id, rows[1].id, code])
    return rows.map(row => row.id)
  })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText('Найдено: 3', { exact: true })).toBeVisible()
  await revealClosureColumn(page, 'workClosureActNumber')
  const row = journalRow(page, ids[0])
  const positions = (field: ClosureHeader) => row.locator('[col-id="' + closureIds[field] + '"] button > span')
  await expect(positions('Вид работ')).toHaveText('1. Сварка 2. ВИК 3. ТВМТ 4. ГИ')
  await expect(positions('КС3')).toHaveText('1. Без КС3 2. 17 3. 18 4. 19')
  const codes = positions('Код работ')
  const fullCodes = '1. ' + code + ' 2. ' + code + ' 3. — 4. —'
  await expect(codes).toHaveText(fullCodes)
  await expect(codes).toHaveCSS('white-space', 'nowrap')
  await expect(codes).toHaveCSS('text-overflow', 'ellipsis')
  expect(await codes.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  const heights = await Promise.all(ids.map(id => journalRow(page, id).evaluate(el => el.getBoundingClientRect().height)))
  expect(heights[0]).toBeGreaterThan(0)
  expect(heights).toEqual([heights[0], heights[0], heights[0]])

  const tooltip = page.getByRole('tooltip')
  for (const [field, expected] of [
    ['Вид работ', ['Сварка', 'ВИК', 'ТВМТ', 'ГИ']],
    ['Код работ', [code, code, '—', '—']],
    ['КС3', ['Без КС3', '17', '18', '19']],
  ] as const) {
    const button = positions(field).locator('..')
    // A native truncated-text tooltip is outside the DOM. Check the actual
    // hit target across the text as well as the single application tooltip.
    expect(await button.evaluate(el => {
      const rect = el.getBoundingClientRect()
      return [2, rect.width / 2, rect.width - 2].every(offset => {
        const hit = document.elementFromPoint(rect.left + offset, rect.top + rect.height / 2)
        return hit === el && !hit.closest('[title]')?.getAttribute('title') && getComputedStyle(hit).textOverflow === 'clip'
      })
    })).toBe(true)
    await button.hover()
    await expect(tooltip.locator('strong')).toHaveText(field)
    await expect(tooltip.locator('li > span:last-child')).toHaveText([...expected])
    await expect(tooltip.locator('li > span:first-child')).toHaveText(['1', '2', '3', '4'])
    await expect(button).toHaveAttribute('aria-describedby', (await tooltip.getAttribute('id'))!)
    if (field === 'Вид работ') await tooltip.screenshot({ path: info.outputPath('closure-tooltip.png') })
    await tooltip.locator('li').last().hover()
    await expect(tooltip).toBeVisible()
    if (field === 'Код работ') expect(await tooltip.locator('ol').evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await expect(tooltip).toHaveCount(0)
  }

  const rates = await openClosureFilter(page, 'Код работ')
  await expect(rates.getByRole('checkbox', { name: code, exact: true }).locator('..').locator('.journal-count')).toHaveText('2')
  await rates.getByRole('button', { name: 'Сводка', exact: true }).click()
  const summary = page.getByRole('dialog', { name: 'Сводка по кодам работ' })
  const count = (...labels: string[]) => summary.getByRole('button', { name: ['Показать стыки', ...labels].join(' · '), exact: true })
  await expect(count(code)).toHaveText('2')
  await expect(count(code, 'Сварка', 'Без КС3')).toHaveText('2')
  await expect(count(code, 'ВИК', '17')).toHaveText('1')
  await count(code, 'Сварка', 'Без КС3').click()
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  await expect(positions('Вид работ')).toHaveText('Сварка')
  await expect(positions('КС3')).toHaveText('Без КС3')
  await positions('Код работ').locator('..').focus()
  await expect(tooltip.getByRole('listitem')).toHaveText([code])
  await page.keyboard.press('Escape')
  const types = await openClosureFilter(page, 'Вид работ')
  const noRecords = types.locator('.journal-filter-values').getByLabel('Без записей о закрытии', { exact: true })
  await expect(noRecords.locator('..').locator('.journal-count')).toHaveText('1')
  await noRecords.check()
  await expect(types.getByLabel('Сварка', { exact: true })).not.toBeChecked()
  await types.getByRole('button', { name: 'Применить' }).click()
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(journalRow(page, ids[2])).toContainText('F043')
})

test('при массовом заполнении можно пропустить или перезаписать отличающиеся коды и КС3', async ({ page }) => {
  const ids = await withLineProgramFixture(async db => {
    const { rows } = await db.query<{ id: number }>("insert into weld_joints(project_title,line,joint) values($1,'RATE-LINE','F031'),($1,'RATE-LINE','F032') returning id", [project])
    const ids = rows.map(row => row.id)
    await db.query("insert into work_closures(weld_joint_id,work_type,rate_code,act_number) values($1,'Сварка','','2'),($2,'Сварка','OLD','1')", ids)
    return ids
  })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  const dialog = page.getByRole('dialog', { name: 'Закрытие работ', exact: true })
  const open = async (command: string) => {
    for (const id of ids) await selectJournalJoint(page, id)
    await journalRow(page, ids[0]).locator('[col-id="joint"]').click({ button: 'right' })
    await page.getByRole('button', { name: 'Закрытие работ', exact: true }).hover()
    await page.getByRole('button', { name: command, exact: true }).click()
    await dialog.getByLabel('Вид работы', { exact: true }).selectOption('Сварка')
  }
  const values = () => withE2eDatabase(async db => (await db.query('select rate_code,act_number from work_closures where weld_joint_id=any($1::int[]) order by weld_joint_id', [ids])).rows)
  const overwrite = dialog.getByRole('button', { name: 'Перезаписать', exact: true })
  const skip = dialog.getByRole('button', { name: 'Пропустить', exact: true })
  const save = dialog.getByRole('button', { name: 'Сохранить закрытия' })
  await open('Указать КС3')
  await dialog.getByLabel('Номер КС3').fill('2')
  await dialog.getByLabel('Код работ', { exact: true }).fill('NEW')
  await expect(skip).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByText('Показать позиции', { exact: true }).click()
  await expect(dialog.getByText(/F032.*Код работ OLD → NEW.*КС3 1 → 2/)).toBeVisible()
  await overwrite.click()
  await expect(dialog.getByText('Позиций к сохранению: 2 · стыков: 2')).toBeVisible()
  await skip.click()
  await expect(dialog.getByText('Позиций к сохранению: 1 · стыков: 1')).toBeVisible()
  await save.click()
  await expect(dialog).toBeHidden()
  expect(await values()).toEqual([{ rate_code: 'NEW', act_number: '2' }, { rate_code: 'OLD', act_number: '1' }])

  await open('Указать КС3')
  await dialog.getByLabel('Номер КС3').fill('003')
  await expect(skip).toHaveAttribute('aria-pressed', 'true')
  await expect(save).toBeDisabled()
  await overwrite.click()
  await save.click()
  await expect(dialog).toBeHidden()
  expect(await values()).toEqual([{ rate_code: 'NEW', act_number: '003' }, { rate_code: 'OLD', act_number: '003' }])

  await open('Назначить расценки')
  await dialog.getByLabel('Код работ', { exact: true }).fill('NEW')
  await expect(skip).toHaveAttribute('aria-pressed', 'true')
  await expect(save).toBeDisabled()
  await overwrite.click()
  await expect(dialog.getByText('Позиций к сохранению: 1 · стыков: 1')).toBeVisible()
  await save.click()
  await expect(dialog).toBeHidden()
  expect(await values()).toEqual([{ rate_code: 'NEW', act_number: '003' }, { rate_code: 'NEW', act_number: '003' }])
  const history = await withE2eDatabase(async db => (await db.query(`select c.changes from audit_changes c join audit_operations o on o.id=c.operation_id
    where o.action='saveBulkWorkClosures' and c.entity='work_closures' and c.joint_id=$1 order by c.id`, [ids[1]])).rows)
  expect(history.map(entry => entry.changes)).toEqual([
    { actNumber: { before: '1', after: '003', origin: 'user' } },
    { rateCode: { before: 'OLD', after: 'NEW', origin: 'user' } },
  ])
})

test('текущий отчёт и скачанный Excel сохраняют одни и те же отобранные позиции закрытия', async ({ page }) => {
  await withLineProgramFixture(async db => {
    const { rows } = await db.query<{ id: number }>("insert into weld_joints(project_title,line,joint) values($1,'EXPORT','F051') returning id", [project])
    await db.query("insert into work_closures(weld_joint_id,work_type,rate_code,act_number) values($1,'Сварка','0001','01'),($1,'ВИК','','01'),($1,'РК','REMOVE','02')", [rows[0].id])
  })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await showAllJournalOutputColumns(page)
  await chooseClosureFilter(page, 'КС3', ['01'])
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  const table = modal.frameLocator('iframe').locator('table')
  await expect(table.locator('tbody tr')).toHaveCount(1)
  const headers = await table.locator('thead th').allTextContents()
  expect(headers).toEqual(ALL_JOURNAL_OUTPUT_HEADERS)
  const indexes = ['Вид работ', 'Код работ', 'КС3'].map(label => headers.indexOf(label))
  expect(indexes.every(index => index >= 0)).toBe(true)
  const expected = ['1. Сварка, 2. ВИК', '1. 0001, 2. —', '1. 01, 2. 01']
  const cells = await table.locator('tbody td').allTextContents()
  expect(indexes.map(index => cells[index])).toEqual(expected)
  const pending = page.waitForEvent('download')
  await modal.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const download = await pending
  expect(await download.failure()).toBeNull()
  const workbook = XLSX.read(await readFile((await download.path())!), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' })
  expect(rows).toHaveLength(2)
  expect(rows[0]).toEqual(headers)
  expect(indexes.map(index => rows[1][index])).toEqual(expected)
})

test('длинные сводки прокручиваются до последней группы и открывают её стыки', async ({ page }) => {
  const size = 360
  const lastCode = 'КОД-F360-' + 'Я'.repeat(72)
  await withE2eDatabase(db => db.query(`
    with added as (
      insert into weld_joints(project_title, line, joint)
      select $1, 'SUMMARY', 'F' || lpad(n::text, 3, '0') from generate_series(1, $2::int) n
      returning id, joint
    )
    insert into work_closures(weld_joint_id, work_type, rate_code, act_number)
    select id, 'Сварка', case when joint = 'F360' then $3 else 'КОД-' || joint end, '01' from added
  `, [project, size, lastCode]))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText('Найдено: ' + size, { exact: true })).toBeVisible()
  for (const [column, title, groups] of [
    ['Код работ', 'Сводка по кодам работ', size],
    ['КС3', 'Сводка по КС3', 1],
    ['Вид работ', 'Сводка по видам работ', 1],
  ] as const) {
    const filter = await openClosureFilter(page, column)
    await filter.getByRole('button', { name: 'Сводка', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: title })
    const table = dialog.getByRole('table', { name: title })
    await expect(table).toHaveAttribute('aria-rowcount', String(size + groups + 1))
    await expect(table.getByRole('button').first()).toBeVisible()
    expect(await table.getByRole('row').count()).toBeLessThan(size / 2)
    const last = table.locator('tr[aria-rowindex="' + (size + groups + 1) + '"]')
    await expect.poll(async () => {
      await table.evaluate(element => { const viewport = element.parentElement!; viewport.scrollTop = viewport.scrollHeight })
      return last.isVisible()
    }).toBe(true)
    await expect(last).toContainText(lastCode)
    const button = last.getByRole('button')
    await button.focus()
    if (column === 'Вид работ') {
      await button.press('Enter')
      await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
      await expect(page.locator('.ag-row [col-id="joint"]').filter({ hasText: 'F360' }).first()).toBeVisible()
    } else {
      await button.press('Escape')
      await expect(dialog).toBeHidden()
    }
  }
})
