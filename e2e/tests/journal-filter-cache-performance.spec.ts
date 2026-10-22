import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import type { JournalFilterPage } from '../../src/lib/journal-filter-options'

// Opt-in, identical before/after production-build workload; raw results stay outside Git.
const label = process.env.JOURNAL_FILTER_CACHE_LABEL
test.skip(!label, 'Set JOURNAL_FILTER_CACHE_LABEL to measure the 200000-value filter')
test.use({ trace: 'off', video: 'off' })
const PROJECT = 'E2E Facet Cache Benchmark'
const total = 200000
let previousSettings: string | undefined
test.beforeAll(async () => {
  if (!label) return
  test.setTimeout(600000)
  await withLineProgramFixture(async db => {
    previousSettings = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}') on conflict(key) do update set value=excluded.value`)
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,connection_type,wdi,has_vik,vik_result,vik_request)
      select $1,'FACET','L-'||lpad(((n-1)/1000)::text,3,'0'),'J'||lpad(n::text,6,'0'),
      '2026-10-01','действующий','С17',1,'да','годен','V-1' from generate_series(1,$2::int) n`, [PROJECT,total])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where project_title=$1`, [PROJECT])
    await db.query('analyze weld_joints')
    await db.query('analyze weld_joint_program_states')
  })
})
test.afterAll(async () => {
  if (!label) return
  test.setTimeout(600000)
  await cleanupLineProgramProjects([PROJECT])
  await withLineProgramFixture(db => previousSettings === undefined ? db.query("delete from app_settings where key='other'") : db.query("update app_settings set value=$1 where key='other'",[previousSettings]))
})

test('cached journal filters preserve complete matches with bounded SQL', async ({ page, browser }, info) => {
  test.setTimeout(600000)
  const errors: string[] = [], samples: object[] = []
  page.on('pageerror', error => errors.push(error.message))
  let observed = ''
  page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
  await page.addInitScript(hidden => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset:'custom', hiddenFieldKeys:hidden, customHiddenFieldKeys:hidden, collapsedSections:[], savedViews:[],
  })), WELD_FIELDS.filter(field => !['line','joint','wdi'].includes(field.key)).map(field => field.key))
  const call = async (data: object) => {
    const response = await page.request.post(siblingRpcUrl(observed, 'readJournalFilterPage_createServerFn_handler'), {
      data: await serializeRpcData(data), headers: { origin: new URL(observed).origin, 'sec-fetch-site':'same-origin', 'content-type':'application/json', 'x-tsr-serverFn':'true' },
    })
    expect(response.ok()).toBe(true)
    const payload = await deserializeRpcResponse(await response.text()) as { result: JournalFilterPage; error?: Error }
    if (payload.error) throw payload.error
    return payload.result
  }
  const metrics = async () => {
    if (!process.env.AUDIT_SQL_COUNTS_FILE) return undefined
    await page.waitForTimeout(550) // Instrumentation flushes every 500 ms, outside timed work.
    return JSON.parse(await readFile(process.env.AUDIT_SQL_COUNTS_FILE, 'utf8')) as { statements: number; dispatcherCalculations: unknown[] }
  }
  // Measure the real input/click -> DOM result interval, not Playwright's
  // assertion polling interval (which can add 100–250 ms to fast responses).
  const beginTiming = (event: 'click' | 'input', value: string) => page.evaluate(({event,value}) => {
    const state = {started:0,duration:-1}
    ;(window as unknown as {journalFilterTiming:typeof state}).journalFilterTiming = state
    const observer = new MutationObserver(() => {
      if (state.started && document.querySelector(`.journal-filter-option span[title="${value}"]`)) {
        state.duration = performance.now()-state.started
        observer.disconnect()
      }
    })
    const start = (e: Event) => {
      const selector = event === 'input' ? '[aria-label="Найти значение фильтра"]' : '.ag-header-cell[col-id="joint"] .ag-header-cell-filter-button'
      if (!(e.target instanceof Element) || !e.target.closest(selector)) return
      state.started = performance.now()
      document.removeEventListener(event,start,true)
      observer.observe(document.body,{subtree:true,childList:true,attributes:true})
    }
    document.addEventListener(event,start,true)
  },{event,value})
  const elapsed = () => page.evaluate(() => (window as unknown as {journalFilterTiming:{duration:number}}).journalFilterTiming.duration)
  // Case-insensitive scopes return identical rows but have independent cold cache keys.
  const scopes = [PROJECT, PROJECT.toLowerCase(), PROJECT.toUpperCase(), PROJECT.replace('Facet','facet'), PROJECT.replace('Cache','cache')]
  for (const search of scopes) {
    await page.goto('/journal')
    await page.getByRole('searchbox').fill(search)
    await expect(page.getByText(`Найдено: ${total}`,{exact:true})).toBeVisible({timeout:240000})
    await expect(page.getByRole('button',{name:'J000001',exact:true})).toBeVisible()
    await page.waitForLoadState('networkidle')
    const coldBefore = await metrics()
    await beginTiming('click','J000001')
    await page.locator('.ag-header-cell[col-id="joint"] .ag-header-cell-filter-button').click()
    const dialog = page.getByRole('dialog',{name:'Фильтр: Стык'})
    await expect(dialog.getByRole('checkbox',{name:/J000001/})).toBeVisible({timeout:120000})
    const openingMs = await elapsed()
    expect(openingMs).toBeGreaterThan(0)
    const coldAfter = await metrics()
    const browserSearchMs: number[] = []
    for (let index=100; index<106; index++) {
      await beginTiming('input',`J${index}000`)
      await dialog.getByRole('textbox',{name:'Найти значение фильтра'}).fill(`J${index}`)
      await expect(dialog.getByRole('checkbox',{name:new RegExp(`J${index}000`)})).toBeVisible()
      const duration = await elapsed()
      expect(duration).toBeGreaterThan(0)
      browserSearchMs.push(duration)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await page.waitForLoadState('networkidle')
    const first = await call({fieldKey:'joint',search})
    expect(first.total).toBe(total)
    const before = await metrics(), requestMs: number[] = []
    for (let index=0; index<20; index++) {
      const prefix = `J${100+index}`
      const started = performance.now()
      const result = await call({fieldKey:'joint',search,revision:first.revision,match:prefix})
      requestMs.push(performance.now()-started)
      expect(result.total).toBe(1000)
      expect(result.options.map(option=>option.value)).toEqual(Array.from({length:150},(_,n)=>`${prefix}${String(n).padStart(3,'0')}`))
      expect(result.next).toBe(150)
    }
    const after = await metrics()
    if (before && after) {
      expect(after.dispatcherCalculations.length).toBe(before.dispatcherCalculations.length)
      // The release-readiness gate can refresh its short-lived state during a batch.
      expect(after.statements-before.statements).toBeLessThanOrEqual(20*5+4)
    }
    samples.push({openingMs,browserSearchMs,requestMs,
      openingSql:coldBefore && coldAfter ? coldAfter.statements-coldBefore.statements : undefined,
      warmSql:before && after ? after.statements-before.statements : undefined})
    console.log('FILTER_CACHE_SAMPLE',JSON.stringify(samples.at(-1)))
  }
  expect(errors).toEqual([])
  const result = {label,browser:browser.version(),total,normalCpu:true,samples,errors}
  await writeFile(`/tmp/journal-filter-cache-${label}.json`,JSON.stringify(result,null,2))
  await info.attach('filter-cache.json',{body:JSON.stringify(result),contentType:'application/json'})
})
