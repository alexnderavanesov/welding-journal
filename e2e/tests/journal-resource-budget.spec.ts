import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { deserializeRpcResponse, rpcName } from '../rpc'

// Deliberately opt-in: a long session with 200000 joints, not a routine smoke test.
const enabled = Boolean(process.env.JOURNAL_BUDGET_LABEL)
test.skip(!enabled, 'Set JOURNAL_BUDGET_LABEL to measure the same workload before/after')
test.use({ trace: 'off', video: 'off' })
const PROJECT = 'E2E journal resource budget'
const total = 200000
let previousSettings: string | undefined
let writeDiagnostics = async () => {}
test.afterEach(async () => writeDiagnostics())

test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(600000)
  await withLineProgramFixture(async db => {
    previousSettings = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}') on conflict(key) do update set value=excluded.value`)
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,connection_type,wdi,has_vik,vik_result,vik_request)
      select $1,'BUDGET','B-'||lpad(((n-1)/1000)::text,3,'0'),'J'||lpad(n::text,6,'0'),
      '2026-10-01','действующий','С17',1,'да','годен','V-1' from generate_series(1,$2::int) n`, [PROJECT,total])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where project_title=$1`, [PROJECT])
    await db.query('analyze weld_joints')
    await db.query('analyze weld_joint_program_states')
  })
})
test.afterAll(async () => {
  if (!enabled) return
  test.setTimeout(600000)
  await cleanupLineProgramProjects([PROJECT])
  await withLineProgramFixture(db => previousSettings === undefined ? db.query("delete from app_settings where key='other'") : db.query("update app_settings set value=$1 where key='other'",[previousSettings]))
})

test('journal budgets: expanded stores, full selection and large facets', async ({ page, browserName, browser }) => {
  test.setTimeout(600000)
  const calls: { name: string; bytes: number }[] = [], errors: string[] = [], failures: {status:number;urlLength:number;name:string}[] = []
  const rpcErrors: { name: string; message: string; cause?: string }[] = []
  const networkFailures: { name: string; error: string | undefined }[] = []
  writeDiagnostics = () => writeFile(`/tmp/journal-budget-${process.env.JOURNAL_BUDGET_LABEL}-http.json`, JSON.stringify({ failures, rpcErrors, networkFailures, errors }, null, 2))
  page.on('requestfailed', request => networkFailures.push({ name: rpcName(request.url()), error: request.failure()?.errorText }))
  page.on('response', response => { if(response.status() >= 400) failures.push({status:response.status(),urlLength:response.url().length,name:rpcName(response.url())}) })
  if (process.env.JOURNAL_BUDGET_DEBUG === '1') page.on('response', async response => {
    const name = rpcName(response.url())
    if (!name.startsWith('readJournalGrid_')) return
    try {
      const payload = await deserializeRpcResponse(await response.text()) as { error?: Error }
      if (payload.error) {
        const error = { name, message: String(payload.error).slice(0, 500),
          cause: payload.error.cause === undefined ? undefined : String(payload.error.cause) }
        rpcErrors.push(error); console.log('BUDGET_RPC_ERROR', JSON.stringify(error))
      }
    } catch { /* A deliberately cancelled response may have no body. */ }
  })
  page.on('request', r => { const name=rpcName(r.url()); if(name) calls.push({name,bytes:r.postDataBuffer()?.length??r.url().length}) })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({hidden}) => {
    localStorage.setItem('welding-report-view:v1:weldingJournal',JSON.stringify({activePreset:'custom',hiddenFieldKeys:hidden,customHiddenFieldKeys:hidden,collapsedSections:[],savedViews:[]}))
    localStorage.setItem('welding-journal-ag-grid:v1',JSON.stringify({columns:['line','joint','wdi'].map(colId=>({colId,width:200,pinned:null}))}))
  },{hidden:WELD_FIELDS.filter(f=>!['line','joint','wdi'].includes(f.key)).map(f=>f.key)})
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText(`Найдено: ${total}`,{exact:true})).toBeVisible({timeout:240000})
  await expect(page.getByRole('button',{name:'J000001',exact:true})).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>{
    const element=document.querySelector('.ag-root-wrapper')!
    const key=Object.keys(element).find(key=>key.startsWith('__reactFiber'))!
    let fiber=(element as any)[key]
    while(fiber){if(fiber.stateNode?.api?.getServerSideGroupLevelState){(window as any).journalBudgetApi=fiber.stateNode.api;return true}fiber=fiber.return}
    return false
  })).toBe(true)
  const read = () => page.evaluate(()=>{
    const api=(window as any).journalBudgetApi
    let leaves=0,groups=0,expanded=0
    api.forEachNode((node:any)=>{if(node.group){groups++;if(node.expanded)expanded++}else if(node.data&&!node.stub)leaves++})
    return {leaves,groups,expanded,height:document.documentElement.scrollHeight,y:scrollY,displayed:api.getDisplayedRowCount()}
  })
  await page.locator('.ag-header-cell[col-id="line"]').click({button:'right'})
  await page.getByRole('menuitem',{name:'Сгруппировать по «Линия»',exact:true}).click()
  await expect(page.getByRole('button',{name:'Развернуть группу B-000',exact:true})).toBeVisible()
  const selectionStart=calls.length
  await page.locator('.ag-header').getByRole('checkbox').click()
  await expect(page.locator('.ag-header').getByRole('checkbox')).toBeChecked({timeout:60000})
  const samples=[]
  for(let group=0;group<40;group++){
    const key=`B-${String(group).padStart(3,'0')}`
    await page.evaluate(key=>{
      const api=(window as any).journalBudgetApi,node=api.getRowNode(`group:${JSON.stringify([key])}`)
      if(!node)throw new Error('Missing fixture group '+key)
      node.setExpanded(true);api.ensureIndexVisible(node.rowIndex+1,'top')
    },key)
    await expect(page.getByRole('button',{name:`J${String(group*1000+1).padStart(6,'0')}`,exact:true})).toBeVisible()
    await page.waitForTimeout(160)
    samples.push(await read())
    if(group%10===9) console.log('BUDGET_PROGRESS',group+1,JSON.stringify(samples.at(-1)))
  }
  await page.waitForTimeout(350)
  const retained=await read()
  const counts=calls.slice(selectionStart).filter(c=>c.name.startsWith('countJournalGridSelection'))
  let heap: unknown
  if(browserName==='chromium'){
    const cdp=await page.context().newCDPSession(page)
    await cdp.send('HeapProfiler.collectGarbage')
    heap=await cdp.send('Runtime.getHeapUsage')
  }
  // Returning to an evicted group must preserve expansion, row position and IDs.
  await page.evaluate(()=>{const api=(window as any).journalBudgetApi;api.ensureIndexVisible(api.getRowNode('group:["B-000"]').rowIndex+1,'top')})
  await expect(page.getByRole('button',{name:'J000001',exact:true})).toBeVisible()
  await expect(page.locator('.ag-row').filter({has:page.getByRole('button',{name:'J000001',exact:true})}).getByRole('checkbox')).toBeChecked()
  const returned=await read()
  if(process.env.JOURNAL_BUDGET_LABEL?.startsWith('after')) expect(retained.leaves).toBeLessThanOrEqual(2000)
  await writeFile(`/tmp/journal-budget-${process.env.JOURNAL_BUDGET_LABEL}-stores.json`,JSON.stringify({samples,retained,returned,heap},null,2))
  expect(returned.displayed).toBe(retained.displayed)
  expect(returned.expanded).toBe(40)
  // Cross the unloaded root-group boundary with the same selected IDs.
  await page.evaluate(()=>{const api=(window as any).journalBudgetApi;api.ensureIndexVisible(40150,'top')})
  await expect(page.getByRole('button',{name:'Развернуть группу B-150',exact:true})).toBeVisible()
  await expect(page.getByRole('checkbox',{name:'Выбрать стыки группы B-150',exact:true})).toBeChecked()
  await page.waitForTimeout(250)
  const acrossRoutes=calls.slice(selectionStart).filter(c=>c.name.startsWith('countJournalGridSelection'))
  if (!process.env.JOURNAL_BUDGET_LABEL?.includes('before')) expect(acrossRoutes).toHaveLength(0)
  await page.evaluate(()=>{const api=(window as any).journalBudgetApi;api.ensureIndexVisible(api.getRowNode('group:["B-000"]').rowIndex+1,'top')})
  await expect(page.getByRole('button',{name:'J000001',exact:true})).toBeVisible()
  const firstCheck=page.getByRole('checkbox',{name:'Выбрать стык J000001',exact:true})
  await firstCheck.click()
  await expect(page.getByRole('checkbox',{name:'Выбрать стыки группы B-000',exact:true})).toHaveJSProperty('indeterminate',true)
  await expect(page.locator('.ag-header').getByRole('checkbox')).toHaveJSProperty('indeterminate',true)
  await firstCheck.click()
  await expect(page.locator('.ag-header').getByRole('checkbox')).toBeChecked()
  // A range inside an old, potentially evicted store keeps its exact values.
  await page.evaluate(()=>{const api=(window as any).journalBudgetApi,n=api.getRowNode('group:["B-001"]');api.addCellRange({rowStartIndex:n.rowIndex+1,rowEndIndex:n.rowIndex+1000,columns:['wdi']})})
  await expect(page.getByText('Количество: 1000',{exact:true})).toBeVisible()
  await expect(page.getByText(/^Сумма: 1\s000$/)).toBeVisible()
  await page.evaluate(()=>(window as any).journalBudgetApi.clearCellSelection())
  // A high-cardinality facet must keep remote matches and exact Select Found semantics.
  await page.locator('.ag-header-cell[col-id="joint"] .ag-header-cell-filter-button').click()
  const dialog=page.getByRole('dialog',{name:'Фильтр: Стык'})
  const start=performance.now()
  await expect(dialog.getByRole('checkbox',{name:/J000001/})).toBeVisible({timeout:120000})
  const initialFacetMs=performance.now()-start
  const searchStart=performance.now()
  await dialog.getByRole('textbox',{name:'Найти значение фильтра'}).fill('J199')
  await expect(dialog.getByRole('checkbox',{name:/J199000/})).toBeVisible({timeout:60000})
  const searchFacetMs=performance.now()-searchStart
  const result={label:process.env.JOURNAL_BUDGET_LABEL,browser:browser.version(),normalCpu:true,
    parallelHashDisabled: process.env.PGOPTIONS?.includes('enable_parallel_hash=off') ?? false,total,samples,retained,returned,
    selection:{requests:counts.length,requestBytes:counts.reduce((sum,c)=>sum+c.bytes,0),acrossRoutes:acrossRoutes.length,acrossRoutesBytes:acrossRoutes.reduce((sum,c)=>sum+c.bytes,0)},heap,initialFacetMs,searchFacetMs,errors}
  await writeFile(`/tmp/journal-budget-${process.env.JOURNAL_BUDGET_LABEL}.json`,JSON.stringify(result,null,2))
  console.log('JOURNAL_BUDGET',JSON.stringify(result))
  await dialog.getByRole('button',{name:'Выбрать найденные',exact:true}).click()
  // Closing a pending Select Found intentionally cancels it. Wait for the
  // committed filter before closing; cancellation has its own regression.
  await expect(page.getByText('Найдено: 1000',{exact:true})).toBeVisible({timeout:60000})
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])

})
