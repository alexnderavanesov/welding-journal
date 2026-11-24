import { randomUUID } from 'node:crypto'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { asE2eOwner } from '../with-owner-access'
import { readFile } from 'node:fs/promises'
import { expect, test, type Locator } from '@playwright/test'
import * as XLSX from 'xlsx'
import { requireDb } from '../../src/db'
import { markDispatcherTaskIndexDirty } from '../../src/server/dispatcher-task-index-dirty'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { listWeldingJournalPage as raw_listWeldingJournalPage } from '../../src/server/weld-read'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { editJournalJoint, journalRow, revealJournalColumn } from '../journal-grid'
import { deserializeRpcResponse, rpcName } from '../rpc'

const project = 'E2E material Excel import'
const stamp = 'IMT1'
const line = 'IMPORT-MATERIALS'
const permit = (materialGroups: string, diameterFrom: string, diameterTo: string, thicknessFrom: string, thicknessTo: string) => ({
  id: materialGroups, weldType: 'РАД', materialGroups, diameterFrom, diameterTo, thicknessFrom, thicknessTo,
  validFrom: '2026-01-01', validTo: '2026-12-31', note: '',
})

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(db => db.query('delete from welder_stamps where naks_stamp=$1', [stamp]))
})

async function seed() {
  const ids = await withE2eDatabase(async db => {
    const program = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'IMPORT',$2,'II','Б(а)',0,0) returning id`, [project, line])).rows[0]
    await db.query('insert into welder_stamps(naks_stamp,welder_name,naks_permits) values ($1,$2,$3)',
      [stamp, 'Материалы: реальный импорт', JSON.stringify([permit('М05', '1', '57', '1', '3'), permit('М01', '159', '500', '8', '40')])])
    // A historical row has its material order entered incorrectly. Its D/T,
    // date and official stamps will deliberately be absent from the correction.
    // Use canonical active/actual flags (null) and the derived waiting label;
    // this fixture has no completed control whose facts could be normalized.
    const rows = (await db.query<{ id: number }>(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,
      category,group_name,weld_control_percent,pvk_control_percent,officiality,revision_actuality,
      connection_type,material_group,welding_method,d1,t1,d2,t2,weld_date,has_vik,vik_result,
      stamp_1_k,stamp_1_z,stamp_1_k_fact,stamp_1_z_fact,isometry)
      select $1,$2,'IMPORT',$3,'F9988'||n,'II','Б(а)',0,0,null,null,
        'С17',case when n=1 then 'М01 + М05' else 'М05 + М01' end,'РАД',57,3,159,8,'2026-07-01','да','ожидает заявку',
        $4,$4,$4,$4,'ISO-OLD-'||n from generate_series(1,2) n returning id`, [program.id, project, line, stamp])).rows
    return rows.map(row => row.id)
  })
  await markDispatcherTaskIndexDirty(requireDb(), { scopes: [{ projectTitle: project, subtitleCode: 'IMPORT', line }] })
  await ensureDispatcherTaskIndexFresh()
  return ids
}

const facts = () => withE2eDatabase(async db => (await db.query(
  'select to_jsonb(w) as fact,xmin::text as version from weld_joints w where project_title=$1 order by id', [project])).rows)
const qualificationTasks = () => withE2eDatabase(async db => (await db.query<{ weld_joint_id: number }>(
  `select t.weld_joint_id from dispatcher_row_tasks t join weld_joints w on w.id=t.weld_joint_id
   where w.project_title=$1 and t.code='СП-02' order by t.weld_joint_id`, [project])).rows.map(row => row.weld_joint_id))

function excelFile(name: string, headers: string[], rows: unknown[][]) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Замена данных')
  return { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer }
}

async function expectHighlighted(dialog: Locator, id: number, labels: string[]) {
  const grid = dialog.locator('[data-import-preview-grid]')
  // Short visible values no longer have redundant native tooltips (04.11).
  const idText = grid.locator('[col-id="id"]').getByText(String(id), { exact: true })
  await expect(idText).toBeVisible()
  const rowId = await idText.evaluate(element => element.closest('.ag-row')?.getAttribute('row-id'))
  expect(rowId).toBeTruthy()
  const viewport = grid.locator('.ag-grid-viewport')
  for (const label of labels) {
    const header = grid.getByRole('columnheader', { name: label, exact: true })
    await viewport.evaluate(async element => { element.scrollLeft = 0; await new Promise(requestAnimationFrame) })
    const steps = await viewport.evaluate(element => Math.ceil(element.scrollWidth / Math.max(element.clientWidth / 2, 1)) + 1)
    for (let step = 0; step < steps && !await header.count(); step++) {
      await viewport.evaluate(async element => {
        element.scrollLeft += Math.max(element.clientWidth / 2, 1)
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      })
    }
    await expect(header, `Import preview contains ${label}`).toBeVisible()
    const columnId = await header.getAttribute('col-id')
    await expect(grid.locator(`[row-id="${rowId}"] [col-id="${columnId}"]`), `${label} is highlighted with the other errors`)
      .toHaveClass(/bg-amber-50/)
  }
}

test('Excel: обычный импорт сохраняет выбранные корректные строки, закрытия и историю контроля заполняют отдельно', async ({ browser, baseURL }) => {
  const email = 'excel-audit-' + randomUUID() + '@e2e.test'
  const password = randomUUID()
  await resetE2eAccountFixtureLimits()
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const permissions = (grants: string[]) => withE2eDatabase(db => db.query(
    'update auth_users set permissions=$1::jsonb,revision=revision+1 where email=$2', [JSON.stringify(grants), email]))
  try {
    await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Инженер импорта', email, title: '', role: 'user', permissions: ['welding.view', 'welding.import'] })
    await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password })
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password }, headers: { origin: baseURL! } })).ok()).toBe(true)
    await withE2eDatabase(db => db.query("insert into line_programs(project_title,subtitle_code,line,category) values($1,'IMPORT','EXCEL-NEW','II')", [project]))
    const page = await context.newPage()
    await page.goto('/journal')
    await page.getByRole('button', { name: 'Импорт', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Импорт данных', exact: true })
    const downloading = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
    const workbook = XLSX.read(await readFile((await (await downloading).path())!), { type: 'buffer' })
    const headers = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })[0].map(String)
    for (const label of ['Вид работ', 'Код работ', 'КС3']) expect(headers).not.toContain(label)
    const fields = [...headers, 'Вид работ', 'Код работ', 'КС3']
    const row = (joint: string, date: string) => {
      const values: Record<string, string> = { Проект: project, Шифр: 'IMPORT', Линия: 'EXCEL-NEW', Стык: joint,
        'Дата сварки': date, 'Вид работ': 'Сварка', 'Код работ': 'FROM-BOOK', КС3: 'FROM-BOOK' }
      return fields.map(label => values[label] ?? '')
    }
    const lookup = page.waitForResponse(response => rpcName(response.url()).startsWith('getLineProgramsForImport_'))
    await dialog.locator('input[type=file]').setInputFiles(excelFile('new-and-invalid.xlsx', fields,
      [row('F901', ''), row('F902', '31.02.2026')]))
    expect((await deserializeRpcResponse(await (await lookup).text()) as { result: unknown[] }).result).toEqual([{
      projectTitle: project, subtitleCode: 'IMPORT', line: 'EXCEL-NEW', category: 'II', groupName: null, weldControlPercent: null,
    }])
    await expect(dialog.locator('#import-error-0')).toContainText('31.02.2026')
    const save = dialog.getByRole('button', { name: 'Импортировать 1 строк', exact: true })
    await expect(save).toBeEnabled()
    await permissions(['welding.view', 'welding.edit'])
    await save.click()
    await expect(dialog.getByText(/Сохранение не выполнено/)).toContainText('Недостаточно прав')
    expect(await withE2eDatabase(async db => (await db.query('select id from weld_joints where project_title=$1', [project])).rowCount)).toBe(0)
    await permissions(['welding.view', 'welding.import'])
    await save.click()
    await expect(dialog).toBeHidden()
    const created = await withE2eDatabase(db => db.query(`select w.id,w.joint,
      (select count(*)::int from work_closures c where c.weld_joint_id=w.id) as closures
      from weld_joints w where w.project_title=$1 order by w.id`, [project]))
    expect(created.rows).toEqual([{ id: expect.any(Number), joint: 'F901', closures: 0 }])
    const id = created.rows[0].id
    const history = await withE2eDatabase(db => db.query("select kind from audit_changes where entity='weld_joints' and joint_id=$1", [id]))
    expect(history.rows).toContainEqual({ kind: 'create' })
    const openProject = async () => {
      await page.goto('/journal')
      await revealJournalColumn(page, 'projectTitle')
      await page.locator('.ag-header-cell[col-id="projectTitle"] .ag-header-cell-filter-button').click()
      const filter = page.getByRole('dialog', { name: 'Фильтр: Проект', exact: true })
      await filter.locator('label').filter({ has: page.getByText(project, { exact: true }) }).getByRole('checkbox').check()
      await filter.getByRole('button', { name: 'Закрыть фильтр' }).click()
      await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
    }
    await openProject()
    await expect(journalRow(page, id)).toContainText('F901')
    await withE2eDatabase(db => db.query("insert into work_closures(weld_joint_id,work_type,rate_code) values($1,'Сварка','KEEP')", [id]))
    const prepareDeletion = async () => {
      await page.getByRole('button', { name: 'Импорт', exact: true }).click()
      await dialog.getByRole('button', { name: 'Замена данных', exact: true }).click()
      await expect(dialog.getByText(/из текущего фильтра сварочного журнала: 1\./)).toBeVisible()
      const replacementDownload = page.waitForEvent('download')
      await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
      const replacement = XLSX.read(await readFile((await (await replacementDownload).path())!), { type: 'buffer' })
      const [columns, record] = XLSX.utils.sheet_to_json<unknown[]>(replacement.Sheets[replacement.SheetNames[0]], { header: 1 })
      const version = record[columns.indexOf('__Версия записи')]
      await dialog.locator('input[type=file]').setInputFiles(excelFile('delete.xlsx',
        ['ID записи', '__Версия записи', 'Удалить строку'], [[id, version, 'да']]))
    }
    await prepareDeletion()
    const replace = dialog.getByRole('button', { name: 'Заменить 1 строк', exact: true })
    await replace.click()
    await expect(dialog.getByText(/Сохранение не выполнено/)).toContainText('Недостаточно прав')
    expect(await withE2eDatabase(async db => (await db.query('select 1 from work_closures where weld_joint_id=$1', [id])).rowCount)).toBe(1)
    await permissions(['welding.view', 'welding.import', 'welding.delete'])
    await withE2eDatabase(db => db.query("update weld_joints set isometry='ISO-CONCURRENT' where id=$1", [id]))
    await replace.click()
    await expect(dialog.getByText(/Сохранение не выполнено/)).toContainText(/измен|устарел|свеж/i)
    expect(await withE2eDatabase(async db => (await db.query('select isometry from weld_joints where id=$1', [id])).rows))
      .toEqual([{ isometry: 'ISO-CONCURRENT' }])
    await openProject()
    await expect(journalRow(page, id)).toBeVisible()
    await prepareDeletion()
    await replace.click()
    await expect(dialog).toBeHidden()
    const deleted = await withE2eDatabase(db => db.query(`select
      (select count(*)::int from weld_joints where id=$1) as joints,
      (select count(*)::int from work_closures where weld_joint_id=$1) as closures,
      (select count(*)::int from audit_changes where entity='work_closures' and joint_id=$1 and kind='delete') as logged`, [id]))
    expect(deleted.rows).toEqual([{ joints: 0, closures: 0, logged: 1 }])
  } finally {
    await context.close()
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})

test('Excel: material pairs, simultaneous errors, atomic refusal and final merged qualification after a partial replacement', async ({ page }) => {
  test.setTimeout(120_000)
  const [first, second] = await seed()
  await withE2eDatabase(db => db.query("insert into work_closures(weld_joint_id,work_type,rate_code,act_number) values($1,'Сварка','ORIGINAL','01')", [first]))
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  expect(await qualificationTasks()).toEqual([first])
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(journalRow(page, first)).toBeVisible()
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const view = page.getByRole('dialog', { name: 'Настройка вида журнала', exact: true })
  await view.getByRole('textbox', { name: 'Найти столбец или раздел', exact: true }).fill('Задачи диспетчера')
  await view.getByRole('checkbox', { name: 'Задачи диспетчера', exact: true }).check()
  await view.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
  await revealJournalColumn(page, 'dispatcherTasks')
  await expect(journalRow(page, first).locator('[col-id="dispatcherTasks"]')).toContainText('СП-02')
  await page.getByRole('button', { name: 'Импорт', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Импорт данных', exact: true }) })
  await dialog.getByRole('button', { name: 'Замена данных', exact: true }).click()
  await expect(dialog.getByText(/В шаблон попадут стыки из текущего фильтра сварочного журнала: 2\./)).toBeVisible()
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
  const download = await downloading
  expect(await download.failure()).toBeNull()
  const workbook = XLSX.read(await readFile((await download.path())!), { type: 'buffer' })
  const table = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })
  const headers = table[0].map(String)
  const idColumn = headers.indexOf('ID записи'), versionColumn = headers.indexOf('__Версия записи')
  expect(idColumn).toBeGreaterThanOrEqual(0)
  expect(versionColumn).toBeGreaterThanOrEqual(0)
  const versions = new Map(table.slice(1).map(row => [Number(row[idColumn]), String(row[versionColumn])]))
  expect([...versions.keys()].sort((a, b) => a - b)).toEqual([first, second])
  const before = await facts()
  const file = dialog.locator('input[type=file]')
  const apply = dialog.getByRole('button', { name: /^Заменить(?: \d+ строк)?$/ })

  // One otherwise valid row must not be written while its neighbour has errors.
  await file.setInputFiles(excelFile('several-errors.xlsx',
    ['ID записи', '__Версия записи', 'Группа материалов', 'Дата сварки', 'D1', 'Изометрия'], [
      [first, versions.get(first), 'М01 + М05 + М11', '31.02.2026', 'not-a-number', 'ISO-NEW-1'],
      [second, versions.get(second), 'М05 + М01', '01.07.2026', 57, 'ISO-NEW-2'],
    ]))
  const error = dialog.locator('#import-error-0')
  for (const message of ['31.02.2026', 'not-a-number', 'не более двух']) await expect(error).toContainText(message)
  await expectHighlighted(dialog, first, ['Дата сварки', 'D1', 'Группа материалов'])
  await expect(apply).toBeDisabled()
  expect(await facts()).toEqual(before)
  expect(calls.filter(name => name.startsWith('replaceWeldJoints_'))).toHaveLength(0)

  // The first row's unchanged historical mismatch permits unrelated corrections
  // (27 October clarification). Changing the second row to that same bad order
  // must still be rejected against its stored dimensions and official welder.
  const partialHeaders = ['ID записи', '__Версия записи', 'Группа материалов', 'Изометрия']
  await file.setInputFiles(excelFile('wrong-side-order.xlsx', partialHeaders, [
    [first, versions.get(first), 'М01 + М05', 'ISO-NEW-1'],
    [second, versions.get(second), 'М01 + М05', 'ISO-NEW-2'],
  ]))
  await expect(error).toContainText('СП-02')
  await expect(error).toContainText('Материал 1: М01')
  await expect(error).toContainText('Материал 2: М05')
  await expect(apply).toBeDisabled()
  expect(await facts()).toEqual(before)
  expect(calls.filter(name => name.startsWith('replaceWeldJoints_'))).toHaveLength(0)

  await file.setInputFiles(excelFile('corrected-material-pair.xlsx', [...partialHeaders, 'Вид работ', 'Код работ', 'КС3'], [
    [first, versions.get(first), 'М05+М01', 'ISO-NEW-1', 'Сварка', 'REPLACED', '99'],
    [second, versions.get(second), 'М05 + М01', 'ISO-NEW-2', 'ВИК', 'NEW', '99'],
  ]))
  await expect(dialog.locator('[id^="import-error-"]')).toHaveCount(0)
  await expect(apply).toHaveText('Заменить 2 строк')
  await expect(apply).toBeEnabled()
  // A valid XLSX preview is still subject to the current save settings.
  const previousSettings = await withE2eDatabase(async db => (await db.query(
    "select value, updated_at::text as updated_at from app_settings where key='save-check'")).rows[0])
  try {
    await withE2eDatabase(db => db.query(`insert into app_settings(key,value) values ('save-check','{"officialDls":true}')
      on conflict(key) do update set value=(app_settings.value::jsonb || excluded.value::jsonb)::text, updated_at=now()`))
    await apply.click()
    await expect(dialog.getByText(/Сохранение не выполнено/)).toContainText(/ДЛС/i)
    expect(await facts()).toEqual(before)
  } finally {
    await withE2eDatabase(db => previousSettings ? db.query(
      "update app_settings set value=$1, updated_at=$2 where key='save-check'", [previousSettings.value, previousSettings.updated_at])
      : db.query("delete from app_settings where key='save-check'"))
  }
  await apply.click()
  await expect(dialog).toBeHidden()
  expect(calls.filter(name => name.startsWith('replaceWeldJoints_'))).toHaveLength(2)
  await expect.poll(qualificationTasks, { timeout: 30_000 }).toEqual([])
  const closureRows = await withE2eDatabase(db => db.query(
    'select weld_joint_id,work_type,rate_code,act_number from work_closures where weld_joint_id=any($1::int[])', [[first, second]]))
  expect(closureRows.rows).toEqual([{ weld_joint_id: first, work_type: 'Сварка', rate_code: 'ORIGINAL', act_number: '01' }])
  const after = await facts()
  for (const [index, row] of after.entries()) {
    const { material_group: _oldGroup, isometry: _oldIsometry, updated_at: _oldUpdated, welding_updated_at: _oldWelding, final_status: _oldStatus, ...preserved } = before[index].fact
    expect(row.fact).toMatchObject({ ...preserved, material_group: 'М05 + М01', isometry: `ISO-NEW-${index + 1}` })
    expect(row.version).not.toBe(before[index].version)
  }
  const report = await listWeldingJournalPage({ data: { search: project, pageSize: 100 } })
  expect(report.rows).toHaveLength(2)
  for (const row of report.rows) expect(row.dispatcherTasks ?? '').not.toContain('СП-02')
  await page.reload()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await revealJournalColumn(page, 'dispatcherTasks')
  await expect(journalRow(page, first).locator('[col-id="dispatcherTasks"]')).not.toContainText('СП-02')
  await editJournalJoint(page, first)
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  const groups = editor.getByRole('group', { name: 'Группа материалов', exact: true })
  await expect(groups.getByRole('button', { name: 'М05', exact: true })).toHaveText('М051')
  await expect(groups.getByRole('button', { name: 'М01', exact: true })).toHaveText('М012')
  for (const [label, value] of [['D1', '57'], ['T1', '3'], ['D2', '159'], ['T2', '8']]) {
    await expect(editor.getByRole('textbox', { name: label, exact: true })).toHaveValue(value)
  }
  await expect(editor.getByRole('combobox', { name: 'Клеймо_1', exact: true })).toHaveValue(stamp)
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(errors).toEqual([])
})

const listWeldingJournalPage = asE2eOwner(raw_listWeldingJournalPage, 'welding.view')

test('официальные клейма в Excel без просмотра справочников проверяются на предпросмотре и при записи', async ({ browser, baseURL }) => {
  await seed()
  await resetE2eAccountFixtureLimits()
  const email = 'import-stamp-' + randomUUID() + '@e2e.test'
  const password = randomUUID()
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    await asE2eOwner(inviteAccount, 'welding.view')({
      name: 'Импорт с клеймами', email, title: '', role: 'user', permissions: ['welding.view', 'welding.import'],
    })
    await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password })
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    const requests: string[] = []
    page.on('request', req => { if (req.url().includes('/_serverFn/')) requests.push(rpcName(req.url())) })
    await page.goto('/journal')
    await page.getByRole('button', { name: 'Импорт', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Импорт данных', exact: true })
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
    const book = XLSX.read(await readFile((await (await download).path())!), { type: 'buffer' })
    const columns = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1 })[0].map(String)
    const row = (joint: string, code: string, date = '01.07.2026') => {
      const values: Record<string, string> = { Проект: project, Шифр: 'IMPORT', Линия: line, Стык: joint,
        'Дата сварки': date, 'Тип соединения': 'С17', 'Группа материалов': 'М05 + М01', 'Способ сварки': 'РАД',
        D1: '57', D2: '159', T1: '3', T2: '8', 'Клеймо_1': code }
      return columns.map(label => values[label] ?? '')
    }
    const checkResponse = page.waitForResponse(r => rpcName(r.url()).startsWith('reviewWeldImportStamps_'))
    const file = excelFile('official-stamps.xlsx', columns, [row('F903', stamp), row('F904', 'UNKNOWN', '31.02.2026'), row('F905', stamp)])
    await dialog.locator('input[type=file]').setInputFiles(file)
    const response = await checkResponse
    const result = (await deserializeRpcResponse(await response.text()) as { result: Record<string, unknown>[] }).result
    expect(result).toEqual([expect.objectContaining({ index: 1, fieldKey: 'stamp1K', message: expect.stringContaining('UNKNOWN') })])
    expect(Object.keys(result[0]).sort()).toEqual(['fieldKey', 'index', 'message'])
    const error = dialog.locator('#import-error-0')
    await expect(error).toContainText('UNKNOWN')
    await expect(error).toContainText('31.02.2026')
    const save = dialog.getByRole('button', { name: 'Импортировать 2 строк', exact: true })
    await expect(save).toBeEnabled()
    const suspend = await withE2eDatabase(db => db.query<{ id: number }>(
      'insert into welder_stamp_suspensions(naks_stamp,suspended_from,suspended_to) values($1,$2,$3) returning id',
      [stamp, '2026-06-01', '2026-08-01']))
    try {
      await save.click()
      await expect(dialog.getByText(/Сохранение не выполнено/)).toContainText(/отстран|приостанов/i)
      expect((await withE2eDatabase(db => db.query("select id from weld_joints where project_title=$1 and joint in ('F903','F904','F905')", [project]))).rowCount).toBe(0)
    } finally {
      await withE2eDatabase(db => db.query('delete from welder_stamp_suspensions where id=$1', [suspend.rows[0].id]))
    }
    await save.click()
    await expect(dialog).toBeHidden()
    expect((await withE2eDatabase(db => db.query("select joint,stamp_1_k from weld_joints where project_title=$1 and joint in ('F903','F904','F905') order by joint", [project]))).rows)
      .toEqual([{ joint: 'F903', stamp_1_k: stamp }, { joint: 'F905', stamp_1_k: stamp }])
    expect(requests.filter(name => name.startsWith('reviewWeldImportStamps_'))).toHaveLength(1)
    await revealJournalColumn(page, 'projectTitle')
    await page.locator('.ag-header-cell[col-id="projectTitle"] .ag-header-cell-filter-button').click()
    const projectFilter = page.getByRole('dialog', { name: 'Фильтр: Проект', exact: true })
    await projectFilter.locator('label').filter({ has: page.getByText(project, { exact: true }) }).getByRole('checkbox').check()
    await projectFilter.getByRole('button', { name: 'Закрыть фильтр' }).click()
    await expect(page.getByText('Найдено: 4', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Импорт', exact: true }).click()
    await dialog.getByRole('button', { name: 'Замена данных', exact: true }).click()
    const replacementDownload = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
    const replacement = XLSX.read(await readFile((await (await replacementDownload).path())!), { type: 'buffer' })
    const [headers, ...entries] = XLSX.utils.sheet_to_json<unknown[]>(replacement.Sheets[replacement.SheetNames[0]], { header: 1 })
    const existing = entries.find(record => record[headers.indexOf('Стык')] === 'F903')!
    const id = existing[headers.indexOf('ID записи')]
    const version = existing[headers.indexOf('__Версия записи')]
    const upload = dialog.locator('input[type=file]')
    await upload.setInputFiles(excelFile('partial-replacement.xlsx', ['ID записи', '__Версия записи', 'Группа материалов'],
      [[id, version, 'М01 + М05']]))
    await expect(dialog.locator('#import-error-0')).toContainText(/СП-02/)
    await expect(dialog.getByRole('button', { name: /^Заменить/ })).toBeDisabled()
    expect(requests.filter(name => name.startsWith('reviewWeldImportStamps_'))).toHaveLength(2)
    await upload.setInputFiles(excelFile('unrelated-correction.xlsx', ['ID записи', '__Версия записи', 'Изометрия'],
      [[id, version, 'ISO-only']]))
    await dialog.getByRole('button', { name: 'Заменить 1 строк', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(requests.filter(name => name.startsWith('reviewWeldImportStamps_'))).toHaveLength(2)
    expect((await withE2eDatabase(db => db.query('select isometry,stamp_1_k,material_group from weld_joints where id=$1', [id]))).rows)
      .toEqual([{ isometry: 'ISO-only', stamp_1_k: stamp, material_group: 'М05 + М01' }])
    expect(requests.filter(name => name.startsWith('loadWelderStampRegistrySnapshot_'))).toEqual([])
  } finally {
    await context.close()
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})
