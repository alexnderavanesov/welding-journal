import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { serializeRpcData, deserializeRpcResponse, siblingRpcUrl, rpcName } from '../rpc'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-table-filtering'
import { auditSqlCount } from '../audit-sql'
import { withE2eDatabase } from '../database'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { buildColumnChoiceWhere } from '../../src/server/weld-server-shared'
import type { JournalGridResult } from '../../src/lib/journal-server-grid'

const PROJECT = 'E2E journal server API'
const scale = process.env.JOURNAL_SCALE === '1'
const total = scale ? 200000 : 350
let observed = ''
let savedOther: string | undefined
let apiStatements = 0
let measureSql = false
async function call<T>(page: Page, name: string, data: unknown): Promise<T> {
  const before = measureSql ? await auditSqlCount() : undefined
  const started = performance.now()
  const response = await page.request.post(siblingRpcUrl(observed, name + '_createServerFn_handler'), {
    timeout: 60_000,
    data: await serializeRpcData(data), headers: { origin: new URL(observed).origin, 'sec-fetch-site':'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
  })
  const value = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
  const milliseconds = performance.now() - started
  if (before !== undefined) {
    const statements = (await auditSqlCount())! - before
    apiStatements += statements
    const ranges = name === 'copyJournalGridRange' ? (data as { parts: Array<{ start: number; end: number }> }).parts : []
    // The constant budget covers access, revision, settings, snapshot and
    // batched metadata reads, independent of the selected row count. The
    // sampler measures the whole server process, not an RPC-exclusive trace.
    // Clipboard alone visits 1000-row batches: one row and one fact read.
    const budget = name === 'copyJournalGridRange'
      ? 10 + 2 * Math.ceil(ranges.reduce((sum, part) => sum + part.end - part.start, 0) / 1000)
      : 24
    console.log('JOURNAL_SQL_STEP', JSON.stringify({ name, statements, budget, milliseconds }))
    expect(statements, name).toBeLessThanOrEqual(budget)
  } else if (scale) {
    console.log('JOURNAL_RPC_STEP', JSON.stringify({ name, milliseconds }))
  }
  if (value.error) { if ((value.error as any).cause?.message) console.log('RPC_ERROR_CAUSE', name, (value.error as any).cause.message); throw value.error }
  return value.result
}
test.beforeAll(async () => {
  test.setTimeout(300000)
  await withLineProgramFixture(async db => {
    savedOther = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}') on conflict(key) do update set value=excluded.value`)
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,connection_type,wdi,has_vik,vik_result,vik_request)
      select $1,'API', 'API-'||lpad(((n-1)/1000)::text,3,'0'), 'S'||lpad(n::text,6,'0'),
        '2026-10-01','действующий','С17',1,'да','годен','V-1' from generate_series(1,$2::int) n`, [PROJECT,total])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where project_title=$1`, [PROJECT])
    await db.query('analyze weld_joints'); await db.query('analyze weld_joint_program_states')
  })
})
test.afterAll(async () => {
  test.setTimeout(300000)
  await cleanupLineProgramProjects([PROJECT])
  await withLineProgramFixture(db => savedOther === undefined ? db.query("delete from app_settings where key='other'") : db.query("update app_settings set value=$1 where key='other'", [savedOther]))
})
test('exact server ranges, overlap, grouping and bounded transport at the target scale', async ({ page }, info) => {
  test.setTimeout(300000)
  page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
  await page.addInitScript(({ hidden }) => {
    localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({ activePreset:'custom',hiddenFieldKeys:hidden,customHiddenFieldKeys:hidden,collapsedSections:[],savedViews:[] }))
  }, { hidden: WELD_FIELDS.filter(field => !['line','joint','wdi'].includes(field.key)).map(field => field.key) })
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText(`Найдено: ${total}`, { exact:true })).toBeVisible({ timeout:240000 })
  await page.waitForLoadState('networkidle')
  const metrics = async () => process.env.AUDIT_SQL_COUNTS_FILE ? JSON.parse(await readFile(process.env.AUDIT_SQL_COUNTS_FILE, 'utf8')) : undefined
  if (process.env.AUDIT_SQL_COUNTS_FILE) await page.waitForTimeout(550) // instrumentation flushes every 500ms
  const before = await metrics()
  apiStatements = 0
  measureSql = true
  const query = { columnFilters:{ search:PROJECT }, groupBy:[] }
  const started = performance.now()
  const root = await call<JournalGridResult>(page,'readJournalGrid',{ ...query, route:[], start:0,end:100 })
  expect(root.rowCount).toBe(total); expect(root.rows).toHaveLength(100)
  const range = { ...query, revision:root.revision, anchor:'line', parts:[{ route:[],start:0,end:total,columns:['wdi','joint'] }] }
  const statsStart = performance.now()
  const stats = await call(page,'summarizeJournalGridRange',range)
  expect(stats).toEqual({ count:total*2,numericCount:total,sum:total,average:1 })
  const statsMs = performance.now()-statsStart
  const overlap = await call(page,'summarizeJournalGridRange',{ ...range, parts:[...range.parts,{ route:[],start:0,end:100,columns:['wdi'] }] })
  expect(overlap).toEqual(stats)
  const copy = await call<string>(page,'copyJournalGridRange',{ ...range,parts:[{ route:[],start:90,end:110,columns:['joint','wdi'] }] })
  // Clipboard exports values only (the agreed header removal in 4338cecc).
  expect(copy.split('\r\n')).toHaveLength(20)
  expect(copy.split('\r\n')[0]).toBe('S000091\t1,000')
  const copyStart = performance.now()
  const fullCopy = await call<string>(page,'copyJournalGridRange',{
    ...range,parts:[{route:[],start:0,end:total,columns:['joint','wdi']}],
  })
  const copyMs = performance.now()-copyStart
  const copiedRows = fullCopy.split('\r\n')
  expect(copiedRows).toHaveLength(total)
  expect(copiedRows[0]).toBe('S000001\t1,000')
  expect(copiedRows.at(-1)).toBe(`S${String(total).padStart(6,'0')}\t1,000`)
  const groupStart = performance.now()
  const groups = await call<JournalGridResult>(page,'readJournalGrid',{ ...query,groupBy:['line'],route:[],start:0,end:100,revision:root.revision })
  expect(groups.rowCount).toBe(Math.ceil(total/1000))
  expect(groups.rows[0].journalGroup?.summary).toMatchObject({ joints: Math.min(total,1000),wdi:Math.min(total,1000),status:'годен' })
  expect(groups.rows.every(row => !('rows' in row.journalGroup!.summary))).toBe(true)
  const full = await call<JournalGridResult>(page,'readJournalGrid',{ ...query,groupBy:['projectTitle'],route:[],start:0,end:100,revision:root.revision })
  expect(full.rows[0].journalGroup?.summary).toMatchObject({ joints:total,wdi:total })
  const groupMs = performance.now()-groupStart
  const selected = await call<{ ids:number[] }>(page,'selectJournalGridRows',{ ...query, groupBy:['line'], route:['API-000'],revision:root.revision })
  expect(selected.ids).toHaveLength(Math.min(total,1000))
  const allSelected = await call<{ ids:number[] }>(page,'selectJournalGridRows',{ ...query, route:[],revision:root.revision })
  expect(allSelected.ids).toHaveLength(total)
  const expectedSummary = {
    records: total, joints: total, wdi: total, missingWdi: 0, weldDate: '01.10.2026', missingDates: 0,
  }
  const selectionSummary = { ids: allSelected.ids, snapshot: { revision: root.revision, columnFilters: query.columnFilters } }
  expect(await call(page, 'summarizeJournalGridSelection', selectionSummary)).toEqual(expectedSummary)
  const rangeSelection = await call<{ ids: number[] }>(page, 'selectJournalGridRange', range)
  expect(new Set(rangeSelection.ids)).toEqual(new Set(allSelected.ids))
  expect(await call(page, 'summarizeJournalGridArea', range)).toEqual(expectedSummary)
  const selectionCounts = await call<{total:number;counts:Record<string,number>;snapshot:string;complete:boolean}>(page,'countJournalGridSelection',{ ...query,groupBy:['line'],revision:root.revision,
    ids:allSelected.ids,routes:[['API-000']] })
  expect(selectionCounts).toMatchObject({ total, counts: { '["API-000"]': Math.min(total,1000) }, complete: true, snapshot: expect.any(String) })
  const tokenRequest = { ...query, groupBy: ['line'], revision: root.revision, snapshot: selectionCounts.snapshot, routes: [['API-000'], ['missing']] }
  expect(await call(page, 'countJournalGridSelection', tokenRequest)).toMatchObject({ total, counts: { '["missing"]': 0 } })
  expect(await call(page, 'countJournalGridSelection', { ...tokenRequest, snapshot: 'expired' })).toEqual({ total: 0, counts: {}, expired: true })
  expect(await call(page, 'countJournalGridSelection', { ...tokenRequest, groupBy: ['subtitleCode'] })).toMatchObject({ expired: true })
  const facet = { fieldKey: 'joint', search: PROJECT, revision: root.revision }
  const firstFacet = await call<{options:{value:string}[];total:number;next:number}>(page, 'readJournalFilterPage', facet)
  expect(firstFacet.options).toHaveLength(total <= 1000 ? total : 150); expect(firstFacet.total).toBe(total); expect(firstFacet.next).toBe(total <= 1000 ? undefined : 150)
  const secondFacet = await call<{options:{value:string}[]}>(page, 'readJournalFilterPage', { ...facet, start: 150 })
  expect(secondFacet.options[0].value).toBe('S000151')
  const matches = await call<{values:string[]}>(page, 'selectJournalFilterValues', { ...facet, match: 'S000' })
  expect(matches.values).toHaveLength(Math.min(999, total)); expect(matches.values.at(-1)).toBe(scale ? 'S000999' : 'S000350')
  await expect(call(page,'summarizeJournalGridRange',{ ...range,parts:[{route:[],start:total-1,end:total+1,columns:['wdi']}] })).rejects.toThrow('Диапазон больше')
  const scrollStart = performance.now()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(page.getByRole('button',{name:`S${String(total).padStart(6,'0')}`,exact:true})).toBeVisible({timeout:30000})
  const scrollMs = performance.now()-scrollStart
  const domRows = await page.locator('.ag-grid-scrolling-rows .ag-row').count()
  expect(domRows).toBeLessThan(80)
  const elapsedMs = performance.now()-started
  if (before) await page.waitForTimeout(550)
  const after = await metrics()
  // End the original read/scroll measurement before the separate stale-cache
  // scenarios below. Those intentionally change filters and invalidate data.
  measureSql = false
  const statements = before ? after.statements-before.statements : undefined
  // API budgets above are independent; the remaining work is the browser's
  // final scroll (at most two bounded blocks plus its footer), not a second copy.
  if (statements !== undefined) expect(statements - apiStatements).toBeLessThanOrEqual(48)
  if (typeof after?.journalSelectionAggregations === 'number') {
    // Token reuse, a missing token and a mismatched scope must not rerun the
    // potentially large ID aggregation. Only the original exact selection does.
    expect(after.journalSelectionAggregations - before.journalSelectionAggregations).toBe(1)
  }
  const data = { total,statsMs,groupMs,copyMs,scrollMs,domRows,statements,elapsedMs,groupBytes:Buffer.byteLength(JSON.stringify(groups)),rootBytes:Buffer.byteLength(JSON.stringify(root)) }
  await info.attach('journal-scale.json',{body:JSON.stringify(data,null,2),contentType:'application/json'})
  console.log('JOURNAL_SCALE', JSON.stringify(data))
  const one = { ...query, columnFilters: { search: PROJECT, joint: 'S000001' }, route: [], start: 0, end: 100 }
  expect((await call<JournalGridResult>(page, 'readJournalGrid', one)).rowCount).toBe(1)
  await withLineProgramFixture(db => db.query('update weld_joints set wdi=2, joint=$2 where id=$1',[root.rows[0].id, 'S999999']))
  await expect(call(page,'summarizeJournalGridRange',range)).rejects.toThrow('Данные журнала изменились')
  await expect(call(page,'selectJournalGridRange',range)).rejects.toThrow('Данные журнала изменились')
  await expect(call(page, 'summarizeJournalGridSelection', selectionSummary)).rejects.toThrow('Данные журнала изменились')
  await expect(call(page, 'getJournalReportSummary', { report: 'weldingJournal', revision: root.revision, columnFilters: query.columnFilters })).rejects.toThrow('Данные журнала изменились')
  await expect(call(page, 'countJournalGridSelection', tokenRequest)).rejects.toThrow('Данные журнала изменились')
  await expect(call(page, 'readJournalFilterPage', facet)).rejects.toThrow('Данные журнала изменились')
  if (after) {
    await page.waitForTimeout(550)
    expect((await metrics()).dispatcherCalculations.length).toBe(after.dispatcherCalculations.length)
  }
  // A cached count must not survive a mutation that changes membership.
  const fresh = await call<JournalGridResult>(page, 'readJournalGrid', one)
  expect(fresh.rowCount).toBe(0)
  expect(fresh.rows).toEqual([])
  expect(fresh.revision).not.toBe(root.revision)
  const refreshedFacet = { ...facet, revision: fresh.revision }
  expect(await call(page, 'readJournalFilterPage', { ...refreshedFacet, match: 'S999999' })).toMatchObject({
    total: 1, options: [{value:'S999999',count:1}],
  })
  expect(await call(page, 'readJournalFilterPage', { ...refreshedFacet, match: 'S000001' })).toMatchObject({total:0,options:[]})
  expect(await call(page, 'selectJournalFilterValues', { ...refreshedFacet, match: 'S999999' })).toMatchObject({values:['S999999']})
  // Computed options still load their own settings after the identity fast path.
  const wdiFacet = await call<{options:{value:string;count:number}[]}>(page, 'readJournalFilterPage', { ...refreshedFacet, fieldKey:'wdi' })
  // PostgreSQL numeric values retain their stored scale (e.g. "2.000").
  expect(wdiFacet.options.map(option=>({value:Number(option.value),count:option.count}))).toEqual([
    {value:1,count:total-1},{value:2,count:1},
  ])
})

test('large journal checkbox filters retain report totals and complete output', async ({ page }) => {
  test.setTimeout(scale ? 300_000 : 60_000)
  page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.locator('.ag-root-wrapper')).toBeVisible()
  await expect.poll(() => observed).not.toBe('')
  // This test also runs alone after a failed worker. Let the cold fixture's
  // initial status calculation finish before timing its filtered read; each
  // actual RPC below retains its separate 60-second request timeout.
  await expect(page.getByText(`Найдено: ${total}`, { exact: true })).toBeVisible({ timeout: scale ? 240_000 : 30_000 })
  await page.waitForLoadState('networkidle')
  const largeChoice = buildWeldColumnValueFilter([...Array.from({length:1000},(_,i)=>`S${String(i+1).padStart(6,'0')}`), 'S999999'])
  const largeSummary = await call<{total:number}>(page, 'getJournalReportSummary', { report: 'weldingJournal', search: PROJECT, columnFilters: { joint: largeChoice } })
  expect(largeSummary.total).toBe(Math.min(total,1000))
  const output = await call<{rows:Array<{joint:string}>}>(page, 'listJournalReportRows', {
    page: 1, pageSize: 'all', includeTotals: false, search: PROJECT, columnFilters: { joint: largeChoice },
    sort: { fieldKey: 'joint', direction: 'desc' },
  })
  expect(output.rows).toHaveLength(Math.min(total,1000))
  expect(new Set(output.rows.map(row => row.joint)).size).toBe(output.rows.length)
  expect(output.rows.every(row => /^S(?:\d{6})$/.test(row.joint))).toBe(true)
})

test('source checkbox filters preserve empty, case, literal punctuation and stored numeric text semantics', async () => {
  const samples = [null, '', ' ', '\t', 'ALPHA', ' alpha ', 'АлЬфа', 'альфа', "O'Reilly", '%_', 'A_B', 'ё', 'Ё', '10.000', '10']
  const cases: Array<[string[], number[]]> = [
    [[], []], [[''], [1, 2, 3]], [[' \t ALPHA \n'], [5, 6]], [['АЛЬФА'], [7, 8]],
    [["o'reilly", '%_'], [9, 10]], [['е'], []], [['ё'], [12, 13]], [['10'], [15]], [['10.000'], [14]],
  ]
  await withE2eDatabase(async db => {
    for (const [choices, expected] of cases) {
      for (const padding of [[], Array.from({ length: 1001 }, (_, index) => `ABSENT-${index}`)]) {
        const predicate = buildColumnChoiceWhere(sql`value`, [...choices, ...padding])
        const query = new PgDialect().sqlToQuery(sql`
          select ordinal::int from unnest(${sql.param(samples)}::text[]) with ordinality as samples(value, ordinal)
          where ${predicate} order by ordinal`)
        expect((await db.query(query.sql, query.params)).rows.map(row => row.ordinal)).toEqual(expected)
      }
    }
  })
})
