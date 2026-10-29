import { expect, test, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import { auditSqlCount } from '../audit-sql'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import type { JournalGridResult } from '../../src/lib/journal-server-grid'

const PROJECT = 'E2E report server transfer'
const total = process.env.REPORT_GRID_SCALE === '1' ? 200000 : 1200
let observed = ''
async function call<T>(page: Page, name: string, data: unknown): Promise<T> {
  const response = await page.request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
    data: await serializeRpcData(data), headers: { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin',
      'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
  })
  const value = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
  if (value.error) throw value.error
  return value.result
}
test.beforeAll(async () => {
  test.setTimeout(300000)
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
      connection_type,d1,t1,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,psto_required)
      select $1,'TRANSFER','TRANSFER-'||case when n <= $2/2 then 'A' else 'B' end,'F'||lpad(n::text,6,'0'),
      '2026-10-01','действующий','актуальная','С17',108,4,'да','V','2026-10-01','годен','V','2026-10-01',
      case when n%2=0 then 'да' else null end from generate_series(1,$2::int) n`, [PROJECT,total])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,officiality,has_vik)
      values($1,'TRANSFER','TRANSFER-A','UNWELDED','действующий','да')`, [PROJECT])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1`, [PROJECT])
    await db.query('analyze weld_joints')
  })
})
test.afterAll(async () => { test.setTimeout(300000); await cleanupLineProgramProjects([PROJECT]) })
test.beforeEach(async ({ page }) => {
  page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
  await page.addInitScript(({ hidden }) => {
    for (const report of ['lnk','heatTreatment']) localStorage.setItem(`welding-report-view:v1:${report}`, JSON.stringify({
      activePreset: 'custom', hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [],
    }))
  }, { hidden: WELD_FIELDS.filter(field => !['line','joint','wdi','weldDate','finalStatus','vikResult','pstoResult','tvmtResult'].includes(field.key)).map(field => field.key) })
  await page.goto('/lnk')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText(`Найдено: ${total}`, { exact: true })).toBeVisible({ timeout: 240000 })
})

test('server report scopes keep membership, counts, stages, ranges and facets independent', async ({ page }, info) => {
  test.setTimeout(300000)
  const base = { columnFilters: { search: PROJECT }, groupBy: [] as string[], sort: { fieldKey: 'joint', direction: 'asc' } }
  const measurements = []
  let lnkSnapshot = ''
  await page.waitForLoadState('networkidle')
  for (const [report, count] of [['weldingJournal',total+1],['lnk',total],['heatTreatment',total/2]] as const) {
    const beforeSql = await auditSqlCount()
    const query = { ...base, report }, started = performance.now()
    const root = await call<JournalGridResult>(page,'readJournalGrid',{...query,route:[],start:0,end:100})
    expect(root.rowCount).toBe(count); expect(root.rows).toHaveLength(100)
    const revision = root.revision
    const group = await call<JournalGridResult>(page,'readJournalGrid',{...query,groupBy:['line'],route:[],start:0,end:100,revision})
    expect(group.rowCount).toBe(2)
    expect(group.rows.reduce((sum,row)=>sum+row.journalGroup!.recordCount,0)).toBe(count)
    if (report === 'lnk') for (const row of group.rows) {
      expect(row.journalGroup!.summary.lnkResults?.vikResult).toMatchObject({status:'годен',rejected:0})
      expect(row.journalGroup!.summary.joints).toBe(total/2)
    }
    if (report === 'heatTreatment') for (const row of group.rows) {
      // Main VIK does not satisfy this joint's required pre-heat VIK stage.
      expect(row.journalGroup!.summary).toMatchObject({joints:total/4,pstoResult:{status:'ожидает заявку НК до ТО'}})
    }
    const all = await call<{ids:number[]}>(page,'selectJournalGridRows',{...query,route:[],revision})
    expect(all.ids).toHaveLength(count)
    const rangeSelection = { ...query, revision, anchor: 'line', parts: [
      { route: [], start: 90, end: 110, columns: ['wdi'] },
      { route: [], start: 95, end: 105, columns: ['joint'] },
    ] }
    const selectedRange = await call<{ids: number[]}>(page, 'selectJournalGridRange', rangeSelection)
    expect(new Set(selectedRange.ids)).toEqual(new Set(all.ids.slice(90, 110)))
    const descending = await call<{ids: number[]}>(page, 'selectJournalGridRange', {
      ...rangeSelection, sort: { fieldKey: 'joint', direction: 'desc' }, parts: [{ route: [], start: 0, end: 3, columns: ['joint'] }],
    })
    expect(descending.ids).toEqual(all.ids.slice(-3).reverse())
    const groupedRange = await call<{ids: number[]}>(page, 'selectJournalGridRange', {
      ...rangeSelection, groupBy: ['line'], sort: { fieldKey: 'line', direction: 'desc' },
      parts: [{ route: [], start: 0, end: 1, columns: ['wdi'] }, { route: ['TRANSFER-B'], start: 0, end: 2, columns: ['joint'] }],
    })
    const groupB = await call<{ids: number[]}>(page, 'selectJournalGridRows', { ...query, groupBy: ['line'], route: ['TRANSFER-B'], revision })
    expect(new Set(groupedRange.ids)).toEqual(new Set(groupB.ids))
    await expect(call(page, 'selectJournalGridRange', { ...rangeSelection,
      parts: [{ route: [], start: count - 1, end: count + 1, columns: ['wdi'] }],
    })).rejects.toThrow('Диапазон больше')

    const selected = await call<{total:number;snapshot:string}>(page,'countJournalGridSelection',{...query,ids:all.ids,routes:[],revision})
    expect(selected.total).toBe(count)
    if(report==='lnk') lnkSnapshot=selected.snapshot
    if(report==='heatTreatment') expect(await call(page,'countJournalGridSelection',{
      ...query,snapshot:lnkSnapshot,routes:[],revision,
    })).toMatchObject({expired:true})
    const range = {...query,revision,anchor:'line',parts:[{route:[],start:0,end:count,columns:['joint']}]}
    expect(await call(page,'summarizeJournalGridRange',range)).toEqual({count,numericCount:0,sum:0,average:null})
    const copy = await call<string>(page,'copyJournalGridRange',{...range,parts:[{route:[],start:90,end:110,columns:['joint','vikResult']}]})
    const lines=copy.split('\r\n'); expect(lines).toHaveLength(20)
    expect(lines[0]).toBe(`${report==='heatTreatment'?'F000182':'F000091'}\tгоден`)
    const facet=await call<{total:number;options:unknown[]}>(page,'readJournalFilterPage',{report,search:PROJECT,fieldKey:'joint',revision})
    expect(facet.total).toBe(count); expect(facet.options.length).toBeLessThanOrEqual(1000)
    const ms = performance.now() - started, afterSql = await auditSqlCount()
    const statements = beforeSql === undefined || afterSql === undefined ? undefined : afterSql - beforeSql
    if (statements !== undefined) expect(statements).toBeLessThanOrEqual(200)
    measurements.push({report,count,ms,statements,rootBytes:Buffer.byteLength(JSON.stringify(root)),groupBytes:Buffer.byteLength(JSON.stringify(group))})
  }
  console.info('REPORT_GRID_TRANSFER', JSON.stringify(measurements))
  await info.attach('report-grid-scope-measurements',{body:JSON.stringify(measurements),contentType:'application/json'})
})

for (const [report, route, count] of [['lnk','/lnk',total],['heatTreatment','/psto',total/2]] as const)
test(`${report} selects the full filtered report and keeps actions for hidden selections`, async ({ page }) => {
  test.setTimeout(300000)
  if (report === 'heatTreatment') {
    await page.goto(route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(`Найдено: ${count}`,{exact:true})).toBeVisible()
  }
  const grid=page.locator(`[data-weld-report-grid="${report}"]`)
  await expect(page.getByRole('combobox',{name:'Размер порции строк'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Загрузить ещё',exact:true})).toHaveCount(0)
  const all = grid.getByRole('checkbox',{name:'Выбрать все стыки по текущим фильтрам',exact:true})
  let selectedCount = count
  if (count > 5000) {
    // Preserve the existing LNK/PSTO workflow limit, including its atomic
    // refusal. Full-query selection must not silently lift a business limit.
    const first = grid.locator('.ag-row:not(.ag-row-group)').first().getByRole('checkbox')
    await first.check()
    await all.click()
    await expect(page.getByText('Можно выбрать не более 5 000 стыков за один раз. Прежний выбор сохранён. Уточните поиск или снимите часть выбора.', { exact: true })).toBeVisible()
    await expect(first).toBeChecked()
    await expect(grid.getByText('Выбрано: 1', { exact: true })).toBeVisible()
    // All fixture joints have six digits. This prefix selects 999 joints
    // (499 even-numbered PSTO joints), including many unloaded blocks.
    selectedCount = report === 'lnk' ? 999 : 499
    await page.getByRole('searchbox').fill('F000')
    await expect(page.getByText(`Найдено: ${selectedCount}`, { exact: true })).toBeVisible()
  }
  await all.click()
  await expect(all).toBeChecked()
  await expect(grid.getByText(`Выбрано: ${selectedCount}`,{exact:true})).toBeVisible()
  await expect(grid.getByLabel('Статистика выделения')).toContainText(`Стыков: ${selectedCount}`)
  await expect(grid.getByLabel('Статистика выделения')).toContainText('Сварка: 01.10.2026')
  await page.getByRole('searchbox').fill('NO SUCH TRANSFER JOINT')
  await expect(page.getByText('Найдено: 0',{exact:true})).toBeVisible()
  await expect(grid.getByText(`Выбрано: ${selectedCount}`,{exact:true})).toBeVisible()
  await expect(grid.getByRole('button',{name:'Действия',exact:true})).toBeEnabled()
  await expect(grid.getByLabel('Статистика выделения')).toContainText(`Стыков: ${selectedCount}`)
  await expect(grid.getByRole('button',{name:'Снять выбор',exact:true})).toHaveCount(0)
  await page.getByRole('searchbox').fill(count > 5000 ? 'F000' : PROJECT)
  await expect(page.getByText(`Найдено: ${selectedCount}`,{exact:true})).toBeVisible()
  await expect(all).toBeChecked()
  await all.click()
  await expect(grid.getByText(`Выбрано: ${selectedCount}`,{exact:true})).toHaveCount(0)
})

for (const [report, route, count] of [['lnk', '/lnk', total], ['heatTreatment', '/psto', total / 2]] as const)
test(`${report} Shift+Space adds the area to existing selection`, async ({ page }) => {
  if (report === 'heatTreatment') {
    await page.goto(route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible()
  }
  const grid = page.locator(`[data-weld-report-grid="${report}"]`)
  const row = (index: number) => grid.locator(`.ag-row[row-index="${index}"]`)
  await row(0).getByRole('checkbox').check()
  await row(1).locator('[col-id="wdi"]').click()
  await row(3).locator('[col-id="wdi"]').click({ modifiers: ['Shift'] })
  await page.keyboard.press('Shift+Space')
  await expect(grid.getByText('Выбрано: 4', { exact: true })).toBeVisible()
  await expect(grid.getByLabel('Статистика выделения')).toContainText('По области')
  await expect(grid.getByLabel('Статистика выделения')).toContainText('Стыков: 3')
  for (const index of [0, 1, 2, 3]) await expect(row(index).getByRole('checkbox')).toBeChecked()
  await expect(row(4).getByRole('checkbox')).not.toBeChecked()
})
