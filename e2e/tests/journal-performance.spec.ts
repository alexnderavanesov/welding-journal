import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir, cpus } from 'node:os'
import { join } from 'node:path'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { WELD_FIELDS } from '../../src/lib/weld-fields'

// Explicit opt-in: a repeatable comparison, not the full systemic load audit.
const enabled = process.env.JOURNAL_PERF === '1'
const PROJECT = 'E2E journal performance'
const total = 200000
let saved: string | undefined

test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(300000)
  await withLineProgramFixture(async db => {
    saved = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}') on conflict(key) do update set value=excluded.value`)
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,connection_type,wdi,has_vik,vik_result,vik_request)
      select $1,'PERF', 'PERF-'||lpad(((n-1)/1000)::text,3,'0'), 'S'||lpad(n::text,6,'0'),
      '2026-10-01','действующий','С17',1,'да','годен','V-1' from generate_series(1,$2::int) n`, [PROJECT,total])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where project_title=$1`, [PROJECT])
    await db.query('analyze weld_joints'); await db.query('analyze weld_joint_program_states')
  })
})
test.afterAll(async () => {
  if (!enabled) return
  test.setTimeout(300000)
  await cleanupLineProgramProjects([PROJECT])
  await withLineProgramFixture(db => saved === undefined ? db.query("delete from app_settings where key='other'") : db.query("update app_settings set value=$1 where key='other'", [saved]))
})
async function sampleFrames(page: Page, active: boolean) {
  return page.evaluate(active => {
    type Sample = { active:boolean; last:number; frames:number[]; blankFrames:number; samples:number; minHeight:number; maxHeight:number }
    const scope = window as unknown as { journalPerf:Sample }
    if (active) {
      const state:Sample = { active:true,last:performance.now(),frames:[],blankFrames:0,samples:0,minHeight:Infinity,maxHeight:0 }
      scope.journalPerf = state
      const tick = (now:number) => {
        if (!state.active) return
        state.frames.push(now-state.last); state.last=now; state.samples++
        const text = document.querySelector('.ag-grid-scrolling-rows .ag-row [col-id="joint"]')?.textContent?.trim()
        if (!text && !document.querySelector('[data-journal-pending-preview]')) state.blankFrames++
        const height = document.documentElement.scrollHeight
        state.minHeight=Math.min(state.minHeight,height); state.maxHeight=Math.max(state.maxHeight,height)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      return null
    }
    const state=scope.journalPerf; state.active=false
    const frames=state.frames.slice(1).sort((a,b)=>a-b)
    return { samples:state.samples,blankFrames:state.blankFrames,p95:frames[Math.floor(frames.length*.95)]??0,
      max:frames.at(-1)??0,heightSwing:state.maxHeight-state.minHeight }
  },active)
}

test('journal repeatable filter, sort, grouping, block and renderer comparison', async ({ page }, info) => {
  test.skip(!enabled, 'Set JOURNAL_PERF=1 for the isolated 200000-row comparison')
  test.setTimeout(300000)
  const cdp=await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
  await page.addInitScript(({fields,hidden}) => {
    localStorage.setItem('welding-journal-ag-grid:v1', JSON.stringify({ columns:fields.map(colId=>({colId,pinned:'left',width:colId==='line'?200:120})) }))
    localStorage.setItem('welding-report-view:v1:weldingJournal',JSON.stringify({activePreset:'custom',hiddenFieldKeys:hidden,customHiddenFieldKeys:hidden,collapsedSections:[],savedViews:[]}))
  },{fields:['line','joint','wdi','weldDate'],hidden:WELD_FIELDS.filter(f=>!['line','joint','wdi','weldDate'].includes(f.key)).map(f=>f.key)})
  const calls:string[]=[]
  page.on('request',req=>{const name=rpcName(req.url());if(name)calls.push(name.split('_createServerFn')[0])})
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/journal')
  const search=page.getByRole('searchbox',{name:'Быстрый поиск по отчету'})
  await search.fill(PROJECT)
  await expect(page.getByText(`Найдено: ${total}`,{exact:true})).toBeVisible({timeout:240000})
  const frame=page.locator('.journal-grid-frame')
  const measurements:unknown[]=[]
  const metrics=async()=>{
    await page.waitForTimeout(550)
    return process.env.AUDIT_SQL_COUNTS_FILE ? JSON.parse(await readFile(process.env.AUDIT_SQL_COUNTS_FILE,'utf8')) : {statements:0}
  }
  const measure=async(name:string,action:()=>Promise<void>,ready:()=>Promise<void>)=>{
    const before=await metrics(), index=calls.length
    await sampleFrames(page,true)
    const started=performance.now()
    await action(); await ready(); await expect(frame).toHaveAttribute('aria-busy','false')
    const elapsedMs=performance.now()-started
    const frames=await sampleFrames(page,false)
    const after=await metrics()
    const requests=calls.slice(index).reduce((out,name)=>({...out,[name]:(out[name]??0)+1}),{} as Record<string,number>)
    measurements.push({name,elapsedMs,sql:after.statements-before.statements,requests,...frames})
  }
  for(let i=0;i<5;i++) {
    const line=`PERF-${String(i%2).padStart(3,'0')}`
    await measure(`filter-${i}`,()=>search.fill(line),async()=>{
      await expect(page.locator('.ag-row[row-index="0"] [col-id="line"]')).toHaveText(line)
      await expect(page.getByText('Найдено: 1000',{exact:true})).toBeVisible()
    })
  }
  for(let i=0;i<3;i++) await measure(`sort-${i}`,()=>page.locator('.ag-header-cell[col-id="joint"] .ag-header-cell-text').click(),async()=>{
    await expect(page.locator('.ag-header-cell[col-id="joint"]')).toHaveAttribute('aria-sort',i===0?'ascending':i===1?'descending':'none')
    await expect(page.locator('.ag-row[row-index="0"] [col-id="joint"]')).toContainText(i===1?'S001000':'S000001')
  })
  await measure('group-line',async()=>{
    await page.locator('.ag-header-cell[col-id="line"]').click({button:'right'})
    await page.getByRole('menuitem',{name:/Сгруппировать.*Линия/}).click()
  },async()=>{await expect(page.locator('[data-group-summary="joint"]')).toHaveText(/1\s?000/)})
  await page.getByRole('button',{name:'Снять все группировки',exact:true}).click()
  await expect(page.getByRole('button',{name:'S000001',exact:true})).toBeVisible()
  await measure('blocks',async()=>{
    for(const index of [150,250,350]) {
      await page.evaluate(index=>window.scrollTo(0,document.querySelector('.journal-page-track')!.getBoundingClientRect().top+scrollY+index*54),index)
      await expect(page.locator(`.ag-row[row-index="${index}"] [col-id="joint"]`)).toContainText(`S${String(index+1).padStart(6,'0')}`)
    }
  },async()=>{})
  await page.evaluate(()=>scrollTo(0,0))
  await expect(page.getByRole('button',{name:'S000001',exact:true})).toBeVisible()
  // A separate sampled CPU profile does not contaminate latency measurements.
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start')
  await sampleFrames(page,true)
  for(let i=0;i<30;i++) {
    await page.evaluate(i=>scrollTo(0,240+(i%10)*180),i)
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())))
  }
  const renderFrames=await sampleFrames(page,false)
  const {profile}=await cdp.send('Profiler.stop')
  await info.attach('renderer.cpuprofile',{body:JSON.stringify(profile),contentType:'application/json'})
  const result={total,browserCpuThrottle:4,hostCpu:cpus()[0]?.model,hostCpus:cpus().length,node:process.version,
    measurements,renderFrames,domRows:await page.locator('.ag-grid-scrolling-rows .ag-row').count()}
  expect(errors).toEqual([]); expect(result.domRows).toBeLessThan(80)
  const label=process.env.JOURNAL_PERF_LABEL==='after'?'after':'before'
  await writeFile(join(tmpdir(),`journal-perf-${label}.json`),JSON.stringify(result,null,2))
  await writeFile(join(tmpdir(),`journal-renderer-${label}.cpuprofile`),JSON.stringify(profile))
  console.log('JOURNAL_PERF',JSON.stringify(result))
  if (label === 'after') for (const sample of measurements as { name: string; blankFrames: number }[]) {
    if (/^(filter|sort)-/.test(sample.name)) expect(sample.blankFrames, sample.name).toBe(0)
  }
})
