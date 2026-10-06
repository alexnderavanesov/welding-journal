import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import pg from 'pg'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { listWeldingJournalImportScope } from '../../src/server/weld-import'
import { listReportPage, normalizeWeldPageRequest, listColumnFilterOptions, normalizeWeldColumnFilterOptionsRequest } from '../../src/server/weld-read'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { VISIBLE_FIELDS } from '../../src/lib/weld-fields'
import { splitReportQuickSearch } from '../../src/lib/report-quick-search'
import { buildRowIdListFilters } from '../../src/lib/report-hidden-filters'
import { buildDispatcherTaskServerFilters } from '../../src/lib/dispatcher-task-row-codes'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'

const project = 'E2E computed WDI'
let savedOther: string | undefined
test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    savedOther = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query("insert into app_settings(key,value) values ('other',$1) on conflict(key) do update set value=excluded.value",
      [JSON.stringify({ wdiCalculationMode: 'formula' })])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,spool,weld_date,connection_type,officiality,
      revision_actuality,has_vik,vik_result,final_status,d1,d2,t1,t2,wdi,welding_journal_note)
      select $1,'WDI','WDI-L1','WDI-'||n,case when n<=500 then 'FIRST500' else 'TAIL' end,'2026-09-01','С17','действующий',
        'актуальная','да',case when n=601 then 'годен' end,case when n=601 then 'годен' else 'ожидает заявку' end,
        case when n=601 then 254 else 108 end,108,4,4,777,'История WDI-'||n from generate_series(1,601) n`, [project])
  })
})
test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    if (savedOther === undefined) await db.query("delete from app_settings where key='other'")
    else await db.query("update app_settings set value=$1 where key='other'", [savedOther])
  })
})

test('import scope respects journal basis and quick search before the 500-row limit', async () => {
  await withE2eDatabase(db => db.query(`update weld_joints set vik_control_basis =
    case when joint='WDI-601' then 'ALPHA' else 'BETA' end where project_title=$1`, [project]))
  for (const extra of [{ controlBasisSummary: 'ALPHA' }, { search: 'WDI-601' },
    { controlBasisSummary: 'ALPHA', wdi: '=10' }]) {
    const columnFilters = { projectTitle: `=${project}`, ...extra } as Record<string, string>
    const journal = await listReportPage('weldingJournal', normalizeWeldPageRequest({ ...splitReportQuickSearch(columnFilters), page: 1, pageSize: 100 }))
    expect(journal.rows.map(row => row.joint)).toEqual(['WDI-601'])
    const scope = await listWeldingJournalImportScope({ data: { columnFilters } })
    expect.soft(scope.total).toBe(1)
    expect.soft(scope.limitExceeded).toBe(false)
    expect.soft(scope.rows.map(row => row.joint)).toEqual(['WDI-601'])
  }
})

test('derived import scope includes every matching page and applies the 500/501 boundary after filtering', async () => {
  const scope = () => listWeldingJournalImportScope({ data: { columnFilters: { projectTitle: `=${project}`, controlBasisSummary: 'ALPHA' } } })
  await withE2eDatabase(db => db.query(`update weld_joints set vik_control_basis =
    case when substring(joint from 5)::int<=500 then 'ALPHA' else 'BETA' end where project_title=$1`, [project]))
  const allowed = await scope()
  expect(allowed.total).toBe(500)
  expect(allowed.rows).toHaveLength(500)
  expect(new Set(allowed.rows.map(row => row.joint))).toEqual(new Set(Array.from({ length: 500 }, (_, i) => `WDI-${i + 1}`)))
  await withE2eDatabase(db => db.query("update weld_joints set vik_control_basis='ALPHA' where project_title=$1 and joint='WDI-501'", [project]))
  expect(await scope()).toMatchObject({ total: 501, limitExceeded: true, rows: [] })
})

test('pre-TO, SQL document/dispatcher/row filters and derived values select the same journal/template joints', async () => {
  await ensureDispatcherTaskIndexFresh()
  const id = await withE2eDatabase(async db => {
    const id = (await db.query("select id from weld_joints where project_title=$1 and joint='WDI-601'", [project])).rows[0].id as number
    await db.query("update weld_joints set vik_control_basis='ALPHA', has_rk='да', rk_result='годен', lnk_defect_description='1: ДНО' where id=$1", [id])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,request_name,request_date,conclusion_name,conclusion_date)
      values($1,'ВИК','годен','PRE-ONLY','2026-09-01','PRE-CONCLUSION','2026-09-01')`, [id])
    const doc = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      values('weldingJournal','SCOPE-DOC','scope.xlsx','application/octet-stream',1) returning id`)).rows[0].id
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [doc, id])
    await db.query("insert into dispatcher_row_tasks(weld_joint_id,task_key,code) values($1,'scope-fixture','ДЗ-01') on conflict do nothing", [id])
    return id
  })
  const cases: Array<[Record<string, string>, string[]]> = [
    [{ preVikResult: '=годен' }, ['WDI-601']],
    [{ preVikRequest: '=PRE-ONLY' }, ['WDI-601']],
    [{ preVikConclusion: '=PRE-CONCLUSION', wdi: '=10' }, ['WDI-601']],
    [{ preVikResult: '=ремонт' }, []],
    [{ rkExposureScheme: '=Пользовательская схема', controlBasisSummary: 'ALPHA' }, ['WDI-601']],
    [{ preVikResult: '=годен', controlBasisSummary: '=ВИК: ALPHA', d1: '=254.000' }, ['WDI-601']],
    [{ jsrDocument: '=SCOPE-DOC', controlBasisSummary: 'ALPHA' }, ['WDI-601']],
    [{ dispatcherTasks: buildWeldColumnValueFilter(['ДЗ-01']), controlBasisSummary: 'ALPHA' }, ['WDI-601']],
    [{ ...buildRowIdListFilters([id]), controlBasisSummary: 'ALPHA' }, ['WDI-601']],
    [{ ...buildRowIdListFilters([id], 'exclude'), controlBasisSummary: 'ALPHA' }, []],
    [{ preVikResult: buildWeldColumnValueFilter(['']), controlBasisSummary: 'ALPHA' }, []],
  ]
  for (const [extra, expected] of cases) {
    const columnFilters = { projectTitle: `=${project}`, ...extra }
    const journal = await listReportPage('weldingJournal', normalizeWeldPageRequest({
      ...splitReportQuickSearch(buildDispatcherTaskServerFilters(columnFilters)), page: 1, pageSize: 100,
    }))
    const scope = await listWeldingJournalImportScope({ data: { columnFilters } })
    expect(journal.rows.map(row => row.joint), JSON.stringify(extra)).toEqual(expected)
    expect(scope.rows.map(row => row.joint), JSON.stringify(extra)).toEqual(expected)
    expect(scope.total).toBe(expected.length)
  }
})

test('WDI: the final matching row, 500/501 limits, current table values and complete cards survive filtering', async () => {
  const scope = (filters: Record<string, string>) => listWeldingJournalImportScope({ data: { columnFilters: { projectTitle: `=${project}`, ...filters } } })
  expect((await scope({ wdi: '=4.25' })).total).toBe(600)
  expect((await scope({ wdi: '=4.25' })).limitExceeded).toBe(true)
  expect((await scope({ wdi: '=4.25', spool: '=FIRST500' })).rows).toHaveLength(500)
  await withE2eDatabase(db => db.query("update weld_joints set spool='FIRST500' where project_title=$1 and joint='WDI-501'", [project]))
  expect(await scope({ wdi: '=4.25', spool: '=FIRST500' })).toMatchObject({ total: 501, limitExceeded: true, rows: [] })
  const match = await scope({ wdi: buildWeldColumnValueFilter(['10']) })
  expect(match.rows).toHaveLength(1)
  expect(match.rows[0]).toMatchObject({ joint: 'WDI-601', wdi: 10, weldingJournalNote: 'История WDI-601' })
  expect((await scope({ wdi: '=777' })).rows).toHaveLength(0)
  const page = await listReportPage('weldingJournal', normalizeWeldPageRequest({ page: 2, pageSize: 100,
    sort: { fieldKey: 'joint', direction: 'asc' }, columnFilters: { projectTitle: `=${project}`, wdi: '=4.25' } }))
  expect(page.total).toBe(600)
  expect(page.rows[0].joint).toBe('WDI-101')
  expect(page.rows[99].weldingJournalNote).toBe('История WDI-200')
  expect(page.acceptedWdiTotal).toBe(0)
  await withE2eDatabase(async db => {
    await db.query("update app_settings set value=$1 where key='other'", [JSON.stringify({ wdiCalculationMode: 'table',
      wdiTable: { diameters: [100, 200], thicknesses: [3], values: [[3.5], [9]] } })])
  })
  const table = await scope({ wdi: '=9' })
  expect(table.rows).toHaveLength(1)
  expect(table.rows[0].wdi).toBe(9)
  expect((await scope({ wdi: '=10' })).rows).toHaveLength(0)
  await withE2eDatabase(db => db.query("update app_settings set value=$1 where key='other'", [JSON.stringify({ wdiCalculationMode: 'manual' })]))
  const manualOptions = await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({ report: 'weldingJournal', fieldKey: 'wdi',
    columnFilters: { projectTitle: `=${project}` } }))
  const manualValue = manualOptions.find(option => Number(option.value) === 777)!.value
  expect(await scope({ wdi: buildWeldColumnValueFilter([manualValue]) })).toMatchObject({ total: 601, limitExceeded: true, rows: [] })
})

test('WDI import holds one read snapshot while another client changes the matching dimensions', async () => {
  const original = pg.Client.prototype.query
  let changed = false
  pg.Client.prototype.query = function(this: pg.Client, ...args: unknown[]) {
    const query = args[0] as { text?: string }
    if (!changed && query?.text?.startsWith('select') && query.text.includes('"welding_journal_note"')) {
      changed = true
      return withE2eDatabase(db => db.query("update weld_joints set d1=508 where project_title=$1 and joint='WDI-601'", [project]))
        .then(() => (original as (...args: unknown[]) => unknown).apply(this, args))
    }
    return (original as (...args: unknown[]) => unknown).apply(this, args)
  } as typeof original
  try {
    const result = await listWeldingJournalImportScope({ data: { columnFilters: { projectTitle: `=${project}`, wdi: '=10' } } })
    expect(changed).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ joint: 'WDI-601', wdi: 10, d1: 254 })
    await withE2eDatabase(async db => {
      expect((await db.query("select d1::float8 as d1,xmin::text as version from weld_joints where project_title=$1 and joint='WDI-601'", [project])).rows[0])
        .toMatchObject({ d1: 508, version: expect.not.stringMatching(`^${result.rows[0].rowVersion}$`) })
    })
  } finally { pg.Client.prototype.query = original }
})

test('pre-TO import selection and returned history share one snapshot during a concurrent correction', async () => {
  await withE2eDatabase(db => db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,request_name)
    select id,'ВИК','годен','PRE-OLD' from weld_joints where project_title=$1 and joint='WDI-601'`, [project]))
  const original = pg.Client.prototype.query
  let changed = false
  pg.Client.prototype.query = function(this: pg.Client, ...args: unknown[]) {
    const query = args[0] as { text?: string }
    if (!changed && query?.text?.startsWith('select') && query.text.includes('"welding_journal_note"')) {
      changed = true
      return withE2eDatabase(db => db.query(`update pre_heat_treatment_controls set request_name='PRE-NEW'
        where weld_joint_id in(select id from weld_joints where project_title=$1 and joint='WDI-601')`, [project]))
        .then(() => (original as (...args: unknown[]) => unknown).apply(this, args))
    }
    return (original as (...args: unknown[]) => unknown).apply(this, args)
  } as typeof original
  try {
    const filters = { projectTitle: `=${project}`, preVikRequest: '=PRE-OLD' }
    const result = await listWeldingJournalImportScope({ data: { columnFilters: filters } })
    expect(changed).toBe(true)
    expect(result.total).toBe(1)
    expect(result.rows[0].preVikRequest).toBe('PRE-OLD')
    expect(result.rows[0].preHeatTreatmentControls?.[0].requestName).toBe('PRE-OLD')
    expect(await listWeldingJournalImportScope({ data: { columnFilters: filters } })).toMatchObject({ total: 0, rows: [] })
  } finally { pg.Client.prototype.query = original }
})

test('WDI filter and mass-fill use the same current result without refetching on focus/reconnect', async ({ page }) => {
  const calls: string[] = [], errors: string[] = []
  page.on('request', req => { if (req.url().includes('/_serverFn/')) calls.push(rpcName(req.url()).split('_')[0]) })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(hiddenFieldKeys => {
    localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({ activePreset: 'custom', hiddenFieldKeys,
      customHiddenFieldKeys: hiddenFieldKeys, collapsedSections: [], savedViews: [] }))
  }, VISIBLE_FIELDS.filter(field => !['joint', 'wdi', 'projectTitle'].includes(field.key)).map(field => field.key))
  await page.goto('/journal')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'WDI. Открыть фильтр', exact: true }).click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: WDI', exact: true })
  await filter.getByRole('button', { name: /^10\s/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByText('WDI-601', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Импорт', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Импорт данных', exact: true }) })
  await dialog.getByRole('button', { name: 'Массовое заполнение', exact: true }).click()
  await expect(dialog.getByText(/В шаблон попадут стыки из текущего фильтра сварочного журнала: 1\./)).toBeVisible()
  await page.waitForLoadState('networkidle')
  const count = (name: string) => calls.filter(call => call === name).length
  expect(count('listWeldingJournalImportScope')).toBe(1)
  const before = calls.length
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  await page.waitForLoadState('networkidle')
  expect(calls.length).toBe(before)
  expect(errors).toEqual([])
})

test('quick-search templates contain only the visible match in both modes; cancellation writes nothing', async ({ page }) => {
  const calls: string[] = [], errors: string[] = []
  page.on('request', req => { if (req.url().includes('/_serverFn/')) calls.push(rpcName(req.url()).split('_')[0]) })
  page.on('pageerror', error => errors.push(error.message))
  const snapshot = () => withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where project_title=$1 order by id', [project])).rows)
  const before = await snapshot()
  await page.goto('/journal')
  await page.getByPlaceholder('Поиск по отчету').fill('WDI-601')
  await expect(page.getByText('WDI-601', { exact: true })).toBeVisible()
  await expect(page.getByText('WDI-600', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Импорт', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Импорт данных', exact: true }) })
  for (const mode of ['Массовое заполнение', 'Замена данных']) {
    await dialog.getByRole('button', { name: mode, exact: true }).click()
    await expect(dialog.getByText(/В шаблон попадут стыки из текущего фильтра сварочного журнала: 1\./)).toBeVisible()
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
    const file = await download
    const workbook = XLSX.read(await readFile((await file.path())!), { type: 'buffer' })
    const cells = JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }))
    expect(cells).toContain('WDI-601')
    expect(cells).not.toContain('WDI-600')
  }
  expect(calls.filter(name => name === 'listWeldingJournalImportScope')).toHaveLength(1)
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
