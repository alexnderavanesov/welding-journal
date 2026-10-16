import { readFile } from 'node:fs/promises'
import { expect, test, type Locator } from '@playwright/test'
import * as XLSX from 'xlsx'
import { requireDb } from '../../src/db'
import { markDispatcherTaskIndexDirty } from '../../src/server/dispatcher-task-index-dirty'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { listWeldingJournalPage } from '../../src/server/weld-read'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { editJournalJoint, journalRow, revealJournalColumn } from '../journal-grid'
import { rpcName } from '../rpc'

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
      stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,isometry)
      select $1,$2,'IMPORT',$3,'F9988'||n,'II','Б(а)',0,0,null,null,
        'С17',case when n=1 then 'М01 + М05' else 'М05 + М01' end,'РАД',57,3,159,8,'2026-07-01','да','ожидает заявку',
        $4,$4,$4,$4,$4,$4,'ISO-OLD-'||n from generate_series(1,2) n returning id`, [program.id, project, line, stamp])).rows
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
  const headers = await dialog.locator('table thead th').allTextContents()
  for (const label of labels) {
    const index = headers.findIndex(value => value.trim() === label)
    expect(index, `Import preview contains ${label}`).toBeGreaterThanOrEqual(0)
    await expect(dialog.locator(`#import-preview-id-${id} td`).nth(index), `${label} is highlighted with the other errors`)
      .toHaveClass(/bg-amber-50/)
  }
}

test('Excel: material pairs, simultaneous errors, atomic refusal and final merged qualification after a partial replacement', async ({ page }) => {
  test.setTimeout(120_000)
  const [first, second] = await seed()
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

  // Syntactically valid partial input is still checked against the stored
  // dimensions and official welder; omission must not bypass either side.
  const partialHeaders = ['ID записи', '__Версия записи', 'Группа материалов', 'Изометрия']
  await file.setInputFiles(excelFile('wrong-side-order.xlsx', partialHeaders, [
    [first, versions.get(first), 'М01 + М05', 'ISO-NEW-1'],
    [second, versions.get(second), 'М05 + М01', 'ISO-NEW-2'],
  ]))
  await expect(error).toContainText('СП-02')
  await expect(error).toContainText('Материал 1: М01')
  await expect(error).toContainText('Материал 2: М05')
  await expect(apply).toBeDisabled()
  expect(await facts()).toEqual(before)
  expect(calls.filter(name => name.startsWith('replaceWeldJoints_'))).toHaveLength(0)

  await file.setInputFiles(excelFile('corrected-material-pair.xlsx', partialHeaders, [
    [first, versions.get(first), 'М05+М01', 'ISO-NEW-1'],
    [second, versions.get(second), 'М05 + М01', 'ISO-NEW-2'],
  ]))
  await expect(dialog.locator('[id^="import-error-"]')).toHaveCount(0)
  await expect(apply).toHaveText('Заменить 2 строк')
  await expect(apply).toBeEnabled()
  await apply.click()
  await expect(dialog).toBeHidden()
  expect(calls.filter(name => name.startsWith('replaceWeldJoints_'))).toHaveLength(1)
  await expect.poll(qualificationTasks, { timeout: 30_000 }).toEqual([])
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
  await expect(editor.getByRole('combobox', { name: 'Корень_1', exact: true })).toHaveValue(stamp)
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(errors).toEqual([])
})
