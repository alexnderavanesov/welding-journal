import { expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { WELD_FIELDS } from '../src/lib/weld-fields'
import { prepareSafariMeasurementWindow } from './safari-foreground'
import { withE2eDatabase } from './database'

export async function measureJournalSaveInSafari(project: string, count: number, diagnosticPath: string) {
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch('http://127.0.0.1:4445' + path, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result.value))
    return result.value
  }
  const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
  const session = '/session/' + created.sessionId
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const wait = (script: string, timeout = 30_000) => expect.poll(() => execute(script), { timeout }).toBe(true)
  const fill = async (selector: string, value: string) => {
    const element = await command(session + '/element', { using: 'css selector', value: selector })
    await execute('const el=document.querySelector(arguments[0]);el.focus();el.select()', selector)
    await command(session + '/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/value', { text: value })
  }
  const samples: unknown[] = []
  try {
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    await command(session + '/window', { handle: await command(session + '/window') })
    await prepareSafariMeasurementWindow(command, session)
    await command(session + '/url', { url: 'http://127.0.0.1:3100/journal' })
    await wait(`return !!document.querySelector('input[aria-label="Быстрый поиск по отчету"]')`)
    const hidden = WELD_FIELDS.filter(field => !['projectTitle', 'line', 'joint', 'isometry', 'finalStatus'].includes(field.key)).map(field => field.key)
    for (const layout of ['flat', 'single', 'nested']) {
      console.log('SAFARI_SAVE_LAYOUT', layout)
      await execute(`localStorage.removeItem('welding-journal-ag-grid:v1');localStorage.setItem('welding-report-view:v1:weldingJournal',JSON.stringify({activePreset:'custom',hiddenFieldKeys:arguments[0],customHiddenFieldKeys:arguments[0],collapsedSections:[],savedViews:[]}))`, hidden)
      await command(session + '/refresh', {})
      await wait(`return !!document.querySelector('input[aria-label="Быстрый поиск по отчету"]')`)
      await fill('input[aria-label="Быстрый поиск по отчету"]', project)
      await wait(`return document.querySelector('.journal-grid-frame')?.getAttribute('aria-busy')==='false'&&document.body.innerText.includes('Найдено: ${count}')`, 120_000)
      const fields = layout === 'nested' ? ['projectTitle', 'line'] : layout === 'single' ? ['line'] : []
      for (const field of fields) {
        await execute('document.querySelector(`.ag-header-cell[col-id="${arguments[0]}"]`).dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:450,clientY:150}))', field)
        await wait('return [...document.querySelectorAll("[role=menuitem]")].some(e=>e.textContent.startsWith("Сгруппировать по"))')
        await execute('[...document.querySelectorAll("[role=menuitem]")].find(e=>e.textContent.startsWith("Сгруппировать по")).click()')
        await wait('return document.querySelector(".journal-grid-frame")?.getAttribute("aria-busy")==="false"')
      }
      for (const label of layout === 'nested' ? [project, 'STABLE-01'] : layout === 'single' ? ['STABLE-01'] : []) {
        await wait(`return [...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')===${JSON.stringify(`Развернуть группу ${label}`)})`)
        await execute('[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")===`Развернуть группу ${arguments[0]}`).click()', label)
      }
      await wait('return document.querySelector(".journal-grid-frame")?.getAttribute("aria-busy")==="false"&&!!document.querySelector(".ag-row [col-id=joint] button")')
      await execute('window.scrollTo(0,1800)')
      await execute('window.safariScrollSettled=false;requestAnimationFrame(()=>requestAnimationFrame(()=>{window.safariScrollSettled=true}))')
      await wait('return window.safariScrollSettled===true')
      const visibleCell = `const cell=[...document.querySelectorAll('.ag-row [col-id=isometry]')].find(e=>{
        const r=e.getBoundingClientRect();return e.closest('.ag-row').querySelector('[col-id=joint] button')&&r.top>150&&r.bottom<innerHeight-50&&e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})`
      await wait(visibleCell + ';return !!cell')
      const point = await execute(visibleCell + `;
        window.safariSavedRow=cell.closest('.ag-row');window.safariTarget={id:Number(window.safariSavedRow.getAttribute('row-id')),before:cell.textContent};window.safariOriginalRows=[...document.querySelectorAll('[data-welding-journal-grid] .ag-row')];window.safariY=scrollY;
        const rect=cell.getBoundingClientRect();return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}`)
      await command(session + '/actions', { actions: [{ type: 'pointer', id: 'save-cell-mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', origin: 'viewport', x: point.x, y: point.y, duration: 0 },
        { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }, { type: 'pause', duration: 60 },
        { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
      ] }] })
      await wait('return !!document.querySelector("[role=dialog] input[aria-label=Изометрия]")')
      const selector = '[data-safari-save-isometry]'
      await execute(`document.querySelector('[role=dialog] input[aria-label=Изометрия]').dataset.safariSaveIsometry=''`)
      const value = `SAFARI-SMOOTH-${layout}-${Date.now()}`
      await fill(selector, value)
      await wait(`return document.querySelector('${selector}')?.value===${JSON.stringify(value)}`)
      await execute('window.safariTarget.expected=arguments[0];window.safariTarget.typedValue=document.querySelector("[data-safari-save-isometry]").value', value)
      // WebDriver script clicks do not wait for enabled controls as Playwright
      // locator.click does. Do not silently click during form validation.
      await wait(`return [...document.querySelectorAll('[role=dialog] button')].some(b=>b.textContent.trim()==='Сохранить'&&!b.disabled)`)
      await execute(`[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Сохранить').dataset.safariSaveButton=''`)
      const save = await command(session + '/element', { using: 'css selector', value: '[data-safari-save-button]' })
      await execute(`window.safariSample={start:performance.now(),frames:0,shift:0,hidden:document.hidden};window.safariSampling=true;
        const frame=()=>{if(!window.safariSampling)return;window.safariSample.frames++;window.safariSample.shift=Math.max(window.safariSample.shift,Math.abs(scrollY-window.safariY));requestAnimationFrame(frame)};requestAnimationFrame(frame)`)
      await command(session + '/element/' + save['element-6066-11e4-a52e-4f735466cecf'] + '/click', {})
      await wait(`return !document.querySelector('${selector}')&&document.querySelector('.journal-grid-frame')?.getAttribute('aria-busy')==='false'&&[...document.querySelectorAll('.ag-row [col-id=isometry]')].some(e=>e.textContent.includes(${JSON.stringify(value)}))`)
      const sample = await execute(`window.safariSampling=false;return {elapsedMs:performance.now()-window.safariSample.start,frames:window.safariSample.frames,hidden:document.hidden||window.safariSample.hidden,maxScrollShift:window.safariSample.shift,
        originalRows:window.safariOriginalRows.length,retainedRows:window.safariOriginalRows.filter(e=>e.isConnected).length,editedRowRetained:window.safariSavedRow.isConnected}`)
      expect(sample.hidden).toBe(false)
      expect(sample.originalRows).toBeGreaterThan(0)
      expect(sample.frames).toBeGreaterThan(0)
      expect(sample.retainedRows).toBe(sample.originalRows)
      expect(sample.maxScrollShift).toBe(0)
      const target = await execute('return window.safariTarget')
      const stored = await withE2eDatabase(async db => (await db.query('select id,joint,isometry from weld_joints where project_title=$1 and id=$2', [project, target.id])).rows[0])
      expect(stored?.isometry).toBe(value)
      samples.push({ layout, ...sample, target, stored })
    }
    return { browser: created.capabilities.browserVersion, count, samples }
  } catch (error) {
    try {
      const state = await execute(`return {text:document.body.innerText,hidden:document.hidden,focus:document.hasFocus(),y:scrollY,target:window.safariTarget,editedRowConnected:window.safariSavedRow?.isConnected,editedRowText:window.safariSavedRow?.textContent,
        busy:document.querySelector('.journal-grid-frame')?.getAttribute('aria-busy'),inputs:[...document.querySelectorAll('[role=dialog] input')].map(e=>({label:e.getAttribute('aria-label'),value:e.value})),sample:window.safariSample}`)
      const stored = await withE2eDatabase(async db => (await db.query('select id,joint,isometry from weld_joints where project_title=$1 and id=$2', [project, state.target?.id ?? -1])).rows)
      await writeFile(diagnosticPath, JSON.stringify({ samples, state, stored }, null, 2))
      await writeFile(diagnosticPath + '.png', Buffer.from(await command(session + '/screenshot'), 'base64'))
    } catch (diagnosticError) { console.error('Safari diagnostic failed', diagnosticError) }
    throw error
  } finally { await command(session, undefined, 'DELETE') }
}
