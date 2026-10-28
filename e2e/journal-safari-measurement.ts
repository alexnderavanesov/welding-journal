import { expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { prepareSafariMeasurementWindow } from './safari-foreground'

/** SafariDriver creates its own automation window/profile. Never attach to a
 * user's tabs; only navigate this session to the disposable local E2E server. */
export async function measureInstalledSafari(page: Page) {
  const label = process.env.JOURNAL_SAFARI_LABEL!
  const base = 'http://127.0.0.1:4445'
  async function command(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw Error(JSON.stringify(result.value))
    return result.value
  }
  const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
  const session = '/session/' + created.sessionId
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const wait = async (script: string) => {
    await expect.poll(() => execute(script), { timeout: 30_000 }).toBe(true)
  }
  try {
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    const ownHandle = await command(session + '/window')
    await command(session + '/window', { handle: ownHandle })
    await prepareSafariMeasurementWindow(command, session)
    const url = new URL(page.url())
    if (url.hostname !== '127.0.0.1' || url.port !== '3100') throw Error('Safari measurement requires disposable local port 3100')
    const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
    await command(session + '/url', { url: url.origin + '/journal' })
    await execute('for (const [k,v] of Object.entries(arguments[0])) localStorage.setItem(k,v)', storage)
    await command(session + '/refresh', {})
    await wait('return Boolean(document.querySelector("input[type=search]"))')
    // Set the native input value so the React-controlled search receives it.
    await execute('const el=document.querySelector("input[type=search]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,arguments[0]);el.dispatchEvent(new Event("input",{bubbles:true}));', 'E2E server journal')
    await wait('return document.body.innerText.includes("Найдено: 350")')
    if (process.env.JOURNAL_SAFARI_KEYBOARD) {
      console.log('SAFARI_WAITING_FOR_FOREGROUND')
      await expect.poll(() => execute('return !document.hidden && document.hasFocus()'), {
        timeout: 60_000, message: 'Safari keyboard measurement requires an active, visible automation window',
      }).toBe(true)
      const samples: unknown[] = []
      for (const selector of ['.ag-row[row-index="0"] [col-id="line"]', '.ag-row[row-index="0"] [col-id="ag-Grid-SelectionColumn"] input']) {
        await wait(`return Boolean(document.querySelector(${JSON.stringify(selector)}))`)
        const element = await command(session + '/element', { using: 'css selector', value: selector })
        await command(session + '/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/click', {})
        await command(session + '/actions', { actions: [{ type: 'key', id: 'journal-keyboard', actions: [{ type: 'keyDown', value: '\uE013' }, { type: 'keyUp', value: '\uE013' }] }] })
        const sample = await execute('return {active:document.activeElement.tagName, classes:String(document.activeElement.className), header:document.activeElement.closest(".ag-header-cell")?.getAttribute("col-id"), hidden:document.hidden}')
        samples.push({ selector, ...sample }); console.log('SAFARI_KEYBOARD', JSON.stringify(samples.at(-1)))
      }
      await writeFile(`/tmp/journal-safari-keyboard-${label}.json`, JSON.stringify(samples, null, 2))
      expect(samples.every((sample: any) => sample.header)).toBe(true)
      const key = (value: string) => command(session + '/actions', { actions: [{ type: 'key', id: 'journal-keyboard', actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }] }] })
      await key(' ')
      await wait('return document.body.innerText.includes("Выбрано: 350") && document.querySelector(".ag-header input[type=checkbox]").checked')
      await key(' ')
      await wait('return !document.querySelector(".ag-header input[type=checkbox]").checked && !document.querySelector(".journal-server-selected")')
      await key('\uE014'); await key('\uE014') // selection → line → joint
      await wait('return document.activeElement.closest(".ag-header-cell")?.getAttribute("col-id")==="joint"')
      await key(' ')
      await wait('return [...document.querySelectorAll("[role=dialog]")].some(el=>el.getAttribute("aria-label")==="Фильтр: Стык")')
      await key('\uE00C')
      await wait('return document.activeElement.closest(".ag-header-cell")?.getAttribute("col-id")==="joint"')
      await key('\uE007')
      await wait('return document.querySelector(".ag-header-cell[col-id=joint]").getAttribute("aria-sort")==="ascending"')
      await wait('return document.querySelector(".journal-grid-frame").getAttribute("aria-busy")!=="true"')
      await key('\uE007')
      await wait('return document.querySelector(".ag-header-cell[col-id=joint]").getAttribute("aria-sort")==="descending"')
      await wait('return document.querySelector(".journal-grid-frame").getAttribute("aria-busy")!=="true"')
      await key('\uE007') // restore the unsorted fixture before motion measurements
      await wait('return document.querySelector(".ag-header-cell[col-id=joint]").getAttribute("aria-sort")==="none"')
      await wait('return document.querySelector(".journal-grid-frame").getAttribute("aria-busy")!=="true"')
      console.log('SAFARI_HEADER_ACTIONS_PASSED')
      if (process.env.JOURNAL_SAFARI_KEYBOARD === 'only') return
    }
    for (const id of ['line', 'projectTitle', 'subtitleCode']) {
      await execute('document.querySelector(`.ag-header-cell[col-id="${arguments[0]}"]`).dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:500,clientY:150}))', id)
      await wait('return [...document.querySelectorAll("[role=menuitem]")].some(e=>e.textContent.startsWith("Сгруппировать по"))')
      await execute('[...document.querySelectorAll("[role=menuitem]")].find(e=>e.textContent.startsWith("Сгруппировать по")).click()')
    }
    await wait('return Boolean(document.querySelector(".ag-row-group .ag-cell[col-id=line]"))')
    await execute('document.querySelector(".ag-row-group .ag-cell[col-id=line]").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:500,clientY:200}))')
    await wait('return [...document.querySelectorAll("[data-testid=context-action-menu] button")].some(e=>e.textContent.trim()==="Развернуть все")')
    await execute('[...document.querySelectorAll("[data-testid=context-action-menu] button")].find(e=>e.textContent.trim()==="Развернуть все").click()')
    await wait('return [...document.querySelectorAll("button")].some(e=>e.textContent==="S0001")')
    const origin = await execute('return document.querySelector(".journal-page-track").getBoundingClientRect().top+scrollY')
    for (const offset of [6400, 3200, 100]) {
      await execute('scrollTo(0,arguments[0])', origin + offset)
      await new Promise(resolve => setTimeout(resolve, 300))
      await wait('return !document.querySelector(".journal-loading-cell")')
    }
    if (process.env.JOURNAL_SAFARI_INPUT_PROFILE) {
      const input = []
      for (const x of [500, 1000]) {
        const before = await execute('return scrollY')
        const wheel = (deltaY: number) => command(session + '/actions', { actions: [{ type: 'wheel', id: 'journal-body-check', actions: [
          { type: 'scroll', origin: 'viewport', x, y: 600, deltaX: 0, deltaY, duration: 0 }, { type: 'pause', duration: 200 },
        ] }] })
        await wheel(300)
        input.push({ x, before, after: await execute('return scrollY') })
        await wheel(0)
      }
      await writeFile(`/tmp/journal-safari-input-${label}.json`, JSON.stringify(input, null, 2))
      console.log('SAFARI_BODY_WHEEL', JSON.stringify(input))
    }
    const samples: unknown[] = []
    const start = async () => execute(`
      const state={running:true,times:[],xs:[],ys:[],resources:[],foreground:true};window.safariMotion=state;
      const visible=()=>{if(document.hidden||!document.hasFocus())state.foreground=false};visible();
      document.addEventListener('visibilitychange',visible);window.addEventListener('blur',visible);
      window.safariMotionCleanup=()=>{document.removeEventListener('visibilitychange',visible);window.removeEventListener('blur',visible)};
      const viewport=document.querySelector('.ag-grid-viewport');
      const tick=()=>{if(state.running){state.times.push(performance.now());state.xs.push(viewport.scrollLeft);state.ys.push(scrollY);requestAnimationFrame(tick)}};requestAnimationFrame(tick);
      const observer=new PerformanceObserver(list=>state.resources.push(...list.getEntries().map(e=>e.name).filter(n=>n.includes('/_serverFn/'))));observer.observe({type:'resource'});window.safariMotionObserver=observer;
    `)
    const finish = async () => execute(`
      const s=window.safariMotion;s.running=false;window.safariMotionObserver.disconnect();window.safariMotionCleanup();
      const intervals=s.times.slice(1).map((n,i)=>n-s.times[i]).sort((a,b)=>a-b);
      return {foreground:s.foreground&&!document.hidden&&document.hasFocus(),frames:s.times.length,p95:intervals[Math.floor(intervals.length*.95)],max:intervals.at(-1),over25:intervals.filter(n=>n>25).length,travelX:Math.max(...s.xs)-Math.min(...s.xs),travelY:Math.max(...s.ys)-Math.min(...s.ys),resources:s.resources};
    `)
    for (const direction of ['vertical', 'horizontal', 'resize']) for (let repeat = 0; repeat < (process.env.JOURNAL_MOTION_QUICK ? 1 : 3); repeat++) {
      await execute('scrollTo(0,arguments[0]);document.querySelector(".ag-grid-viewport").scrollLeft=0', origin + 100)
      await new Promise(resolve => setTimeout(resolve, 200))
      const actions: unknown[] = []
      if (direction === 'resize') {
        const rect = await execute('const r=document.querySelector(".ag-header-cell[col-id=line] .ag-header-cell-resize").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}')
        actions.push({ type: 'pointerMove', x: rect.x, y: rect.y, duration: 0, origin: 'viewport' }, { type: 'pointerDown', button: 0 })
        for (const sign of [1, -1]) for (let i = 1; i <= 120; i++) actions.push({ type: 'pointerMove', x: rect.x + Math.round(sign === 1 ? i * 1.5 : 180 - i * 1.5), y: rect.y, duration: 8, origin: 'viewport' })
        actions.push({ type: 'pointerUp', button: 0 })
      } else {
        // SafariDriver 26.6 treats wheel delta as input-source state and emits
        // the difference from the preceding value (WebKit SimulatedInputDispatcher).
        // End at zero so each repeat delivers exactly 50 +100/-100 wheel events.
        let delta = 0
        for (const sign of [1, -1]) for (let i = 0; i < 50; i++) {
          delta += sign * 100
          actions.push({ type: 'scroll', origin: 'viewport', x: direction === 'vertical' && process.env.JOURNAL_MOTION_MARGIN ? 1590 : 1000, y: 600, deltaX: direction === 'horizontal' ? delta : 0, deltaY: direction === 'vertical' ? delta : 0, duration: 0 }, { type: 'pause', duration: 30 })
        }
      }
      await start()
      console.log('SAFARI_WINDOW', JSON.stringify(await execute('return {hidden:document.hidden,focused:document.hasFocus(),width:innerWidth,height:innerHeight,x:screenX,y:screenY}')))
      await expect.poll(() => execute('return !document.hidden && window.safariMotion.times.length > 2'), {
        timeout: 5_000, message: 'The separate Safari automation window must remain visible to measure frames',
      }).toBe(true)
      const began = performance.now()
      await command(session + '/actions', { actions: [{ type: direction === 'resize' ? 'pointer' : 'wheel', id: 'journal-' + direction, ...(direction === 'resize' ? { parameters: { pointerType: 'mouse' } } : {}), actions }] })
      const elapsed = performance.now() - began
      await new Promise(resolve => setTimeout(resolve, 100))
      const result = await finish()
      samples.push({ direction, repeat, elapsed, ...result })
      console.log('SAFARI_SAMPLE', JSON.stringify(samples.at(-1)))
      expect(result.foreground, 'Exclude gestures interrupted by a hidden/unfocused Safari window').toBe(true)
      if (direction !== 'resize') expect(result[direction === 'horizontal' ? 'travelX' : 'travelY']).toBeGreaterThan(1000)
      else expect(await execute('return document.querySelector(".ag-header-cell[col-id=line]").getBoundingClientRect().width')).toBe(200)
    }
    const result = { browserVersion: created.capabilities.browserVersion, viewport: await execute('return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio}'), samples }
    await writeFile(`/tmp/journal-safari-${label}.json`, JSON.stringify(result, null, 2))
    console.log('INSTALLED_SAFARI', JSON.stringify(result))
  } finally {
    await command(session, undefined, 'DELETE')
  }
}
