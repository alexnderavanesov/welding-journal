import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

test.use({trace:'off',video:'off'})

// Diagnostic only: the optional page-local style snapshot estimates the cost
// of repeated viewport geometry reads. It is never installed in application code.
test('shared grids: native resize, browser rendering costs and viewport-read diagnostic', async ({page,browser}, info) => {
  test.skip(process.env.AUDIT_SHARED_GRID_LAYOUT !== '1', 'Opt-in local production-build diagnostic')
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  test.setTimeout(300_000)
  const project = 'E2E shared grid layout'
  await withLineProgramFixture(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'LAYOUT','LAYOUT-'||lpad(n::text,2,'0'),'II','Б(а)',10,0 from generate_series(1,10) n`,[project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      connection_type,officiality,revision_actuality,stamp_1_k,stamp_1_k_fact,has_vik,vik_result,psto_required)
      select p.id,p.project_title,p.subtitle_code,p.line,'F'||lpad(n::text,3,'0'),'2026-10-20','С17','действующий','актуальная',
        'LAYA','LAYA','да','годен','да' from line_programs p cross join generate_series(1,35) n where project_title=$1`,[project])
    await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select 'weldingJournal','LAYOUT-DOC-'||n,'layout.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1 from generate_series(1,40) n`)
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select d.id,w.id from generated_documents d cross join weld_joints w
      where d.title like 'LAYOUT-DOC-%' and w.project_title=$1 and w.line='LAYOUT-01' and w.joint='F001'`,[project])
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const measurements: unknown[] = [], calls: string[] = [], errors: string[] = []
  page.on('request', request => {const name=rpcName(request.url());if(name) calls.push(name)})
  page.on('pageerror', error => errors.push(error.message))
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]))
  try {
    for (const [route,selector,column] of [
      ['/journal','.journal-grid-frame','line'], ['/psto','.journal-grid-frame','line'],
      ['/documents','[data-document-history-grid]','title'],
      ['/line-program','[data-program-grid="lines"]','line'],
      ['/statistics','[data-statistics-grid="lines"]','line'],
    ]) {
      await page.goto(route)
      if(route==='/statistics') await page.getByRole('button',{name:'Полинейная сводка',exact:true}).click()
      const grid=page.locator(selector).first()
      await expect(grid.locator('.ag-row[row-id]').first()).toBeVisible()
      if(route==='/journal' || route==='/psto') {
        for(const id of ['line','projectTitle','subtitleCode']) {
          await grid.locator(`.ag-header-cell[col-id="${id}"]`).click({button:'right'})
          await page.getByRole('menuitem',{name:/^Сгруппировать по/}).click()
        }
        await grid.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({button:'right'})
        await page.getByTestId('context-action-menu').getByRole('button',{name:'Развернуть все',exact:true}).click()
      }
      await page.waitForLoadState('networkidle')
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
      const header=grid.locator(`.ag-header-cell[col-id="${column}"]`)
      await header.scrollIntoViewIfNeeded()
      const originalWidth=(await header.boundingBox())!.width
      // A changed row height may first reveal an unloaded nested server block.
      // Warm the exact native gesture before comparing rendering-only costs.
      const warmHandle=(await header.locator('.ag-header-cell-resize').boundingBox())!
      await page.mouse.move(warmHandle.x+warmHandle.width/2,warmHandle.y+warmHandle.height/2)
      await page.mouse.down()
      await page.mouse.move(warmHandle.x+warmHandle.width/2+80,warmHandle.y+warmHandle.height/2,{steps:60})
      await page.mouse.move(warmHandle.x+warmHandle.width/2,warmHandle.y+warmHandle.height/2,{steps:60})
      await page.mouse.up()
      await page.waitForLoadState('networkidle')
      for(const mode of ['baseline','snapshot','snapshot','baseline']) {
        const handle=(await header.locator('.ag-header-cell-resize').boundingBox())!
        await page.evaluate(mode=>{
          const native=window.getComputedStyle.bind(window),cache=new WeakMap<Element,{epoch:number;style:CSSStyleDeclaration}>()
          const state={epoch:0,running:true,times:[] as number[],nativeReads:0,snapshotHits:0}
          const properties=['width','height','boxSizing','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
            'paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft']
          const tick=()=>{if(state.running){state.epoch++;state.times.push(performance.now());requestAnimationFrame(tick)}}
          requestAnimationFrame(tick)
          window.getComputedStyle=(element,pseudo)=>{
            if(!element.classList.contains('ag-grid-viewport') || pseudo) return native(element,pseudo)
            const cached=cache.get(element)
            if(mode==='snapshot' && cached?.epoch===state.epoch){state.snapshotHits++;return cached.style}
            state.nativeReads++
            const style=native(element,pseudo)
            if(mode==='baseline') return style
            const values=Object.fromEntries(properties.map(key=>[key,(style as any)[key]]))
            const proxy=new Proxy(style,{get(target,key){if(typeof key==='string' && key in values)return values[key];
              const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})
            cache.set(element,{epoch:state.epoch,style:proxy});return proxy
          }
          ;(window as any).layoutAudit={state,finish:()=>{state.running=false;window.getComputedStyle=native;return state}}
        },mode)
        const before=await metrics(), callStart=calls.length
        await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2)
        await page.mouse.down()
        await page.mouse.move(handle.x+handle.width/2+80,handle.y+handle.height/2,{steps:60})
        await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2,{steps:60})
        await page.mouse.up()
        const after=await metrics(),sample=await page.evaluate(()=>{
          const state=(window as any).layoutAudit.finish()
          const intervals=state.times.slice(1).map((n:number,i:number)=>n-state.times[i]).sort((a:number,b:number)=>a-b)
          return {nativeReads:state.nativeReads,snapshotHits:state.snapshotHits,frames:intervals.length,
            p95:intervals[Math.floor(intervals.length*.95)],max:intervals.at(-1)}
        })
        expect((await header.boundingBox())!.width).toBeCloseTo(originalWidth,0)
        expect(calls.slice(callStart)).toEqual([])
        measurements.push({route,mode,...sample,requests:calls.slice(callStart),
          scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,
          layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,
          styleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000})
      }
    }
    expect(errors).toEqual([])
    await writeFile(info.outputPath('shared-grid-layout.json'),JSON.stringify({browser:browser.version(),measurements},null,2))
    console.log('SHARED_GRID_LAYOUT',JSON.stringify(measurements))
  } finally {
    await page.evaluate(()=>{(window as any).layoutAudit?.finish()}).catch(()=>{})
    await cdp.detach()
    await page.close()
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(db=>db.query("delete from generated_documents where title like 'LAYOUT-DOC-%'"))
  }
})
