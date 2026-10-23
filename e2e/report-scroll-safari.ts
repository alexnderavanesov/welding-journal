import { expect, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
  const response = await fetch('http://127.0.0.1:4445' + path, { method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) })
  const result = await response.json()
  if (!response.ok || result.value?.error) throw Error(JSON.stringify(result.value))
  return result.value
}
let ownedSafari: { sessionId: string; capabilities: { browserVersion: string } } | undefined
export async function closeInstalledSafariFooter() {
  if (ownedSafari) { const session = ownedSafari; ownedSafari = undefined; await command('/session/' + session.sessionId, undefined, 'DELETE') }
}

/** Opt-in installed Safari check; the driver owns a separate automation profile. */
export async function checkInstalledSafariFooter(page: Page, info: TestInfo, report: string, count: number, search: string) {
  const url = new URL(page.url())
  if (url.hostname !== '127.0.0.1' || url.port !== '3100') throw Error('Requires the disposable local E2E server')
  const created = ownedSafari ??= await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
  const session = '/session/' + created.sessionId
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const settle = () => command(session + '/execute/async', { script: 'const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>done(null)))', args: [] })
  const wait = (script: string) => expect.poll(() => execute(script), { timeout: 30_000 }).toBe(true)
  const footer = report === 'documents' ? '.document-grid-footer' : '[data-journal-footer]'
  const results: any[] = []
  try {
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    await command(session + '/window', { handle: await command(session + '/window') })
    const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
    await command(session + '/url', { url: url.href })
    await execute('for(const [k,v] of Object.entries(arguments[0])) localStorage.setItem(k,v)', storage)
    await command(session + '/refresh', {})
    if (report !== 'documents') {
      await wait('return Boolean(document.querySelector("input[type=search]"))')
      await execute('const el=document.querySelector("input[type=search]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,arguments[0]);el.dispatchEvent(new Event("input",{bubbles:true}))', search)
    }
    await wait(`return document.body.innerText.includes("Найдено: ${count}") && new Set([...document.querySelectorAll('.ag-row.ag-row-group[row-id]')].map(e=>e.getAttribute('row-id'))).size===${count}`)
    await command(session + '/window', { handle: await command(session + '/window') })
    await execute('window.focus()')
    const panel = await command(session + '/element', { using: 'css selector', value: footer })
    await command(session + '/element/' + panel['element-6066-11e4-a52e-4f735466cecf'] + '/click', {})
    console.log('SAFARI_FOREGROUND', JSON.stringify(await execute('return {hidden:document.hidden,focused:document.hasFocus()}')))
    await expect.poll(() => execute('return !document.hidden && document.hasFocus()'), { timeout: 120_000 }).toBe(true)
    const sample = async (name: string, steps: number, distance: number, reference = false) => {
      let capture: ReturnType<typeof spawn> | undefined
      let captureDone: Promise<number | null> | undefined
      if (process.env.SAFARI_WINDOW_RECORDER) {
        const title = `LOCAL-FOOTER-CHECK-${report}-${name}`
        await execute('document.title=arguments[0]', title)
        capture = spawn(process.env.SAFARI_WINDOW_RECORDER, [title, info.outputPath(`safari-${name}.mp4`)])
        capture.stdin!.on('error', () => {}) // The exit check reports a recorder failure.
        captureDone = new Promise(resolve => capture!.on('close', resolve))
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { capture!.kill(); reject(Error('Window recorder did not start')) }, 15_000)
          capture!.stdout!.on('data', data => { if (data.toString().includes('CAPTURE_READY')) { clearTimeout(timer); resolve() } })
          capture!.stderr!.on('data', data => console.log('SAFARI_CAPTURE', data.toString()))
          capture!.on('error', reject)
          capture!.on('close', (code, signal) => { clearTimeout(timer); reject(Error(`Recorder exited ${code ?? signal}`)) })
        })
      }
      try {
        await execute(`
        const s={running:true,frames:[],beforeResize:[],foreground:true};window.safariFooter=s;
        const before=()=>s.beforeResize.push(document.querySelector(arguments[0]).getBoundingClientRect().bottom);
        window.addEventListener('scroll',before,{capture:true,passive:true});
        s.stop=()=>{s.running=false;window.removeEventListener('scroll',before,true)};
        const tick=()=>{if(!s.running)return;const stage=document.querySelector('.journal-page-stage').getBoundingClientRect();
          const panel=document.querySelector(arguments[0]).getBoundingClientRect();
          s.foreground&&=!document.hidden&&document.hasFocus();
          s.frames.push({time:performance.now(),focused:document.hasFocus(),hidden:document.hidden,y:scrollY,height:document.documentElement.scrollHeight,stage:stage.height,stageTop:stage.top,
            bottom:panel.bottom,viewport:innerHeight,visualTop:visualViewport.offsetTop,visualHeight:visualViewport.height,
            grid:document.querySelector('.ag-grid-viewport').scrollTop});requestAnimationFrame(tick)};requestAnimationFrame(tick);
      `, footer)
        let delta = 0
        const actions: unknown[] = []
        for (const direction of [-1, 1, -1, 1]) for (let i = 0; i < steps; i++) {
          // SafariDriver 26.6 uses the difference from its preceding wheel state.
          delta += direction * distance
          actions.push({ type: 'scroll', origin: 'viewport', x: 1000, y: 600, deltaX: 0, deltaY: delta, duration: 0 }, { type: 'pause', duration: 35 })
        }
        await command(session + '/actions', { actions: [{ type: 'wheel', id: 'footer-' + name, actions }] })
      } finally {
        if (capture) { capture.stdin!.end('\n'); expect(await captureDone, 'Window recording must finish').toBe(0) }
      }
      const result = await execute('window.safariFooter.stop();delete window.safariFooter.stop;return window.safariFooter')
      const spread = (key: string) => Math.max(...result.frames.map((f: any) => f[key])) - Math.min(...result.frames.map((f: any) => f[key]))
      const beforeResizeMovement = result.beforeResize.length ? Math.max(...result.beforeResize)-Math.min(...result.beforeResize) : 0
      const metrics = { name, reference, beforeResizeMovement, focusedFrames: result.frames.filter((f: any)=>f.focused).length, visibleFrames: result.frames.filter((f: any)=>!f.hidden).length, frames: result.frames.length, foreground: result.foreground, footerMovement: spread('bottom'), pageHeightChange: spread('height'),
        minY: Math.min(...result.frames.map((f: any) => f.y)), maxY: Math.max(...result.frames.map((f: any) => f.y)),
        minBottom: Math.min(...result.frames.map((f: any) => f.bottom)), maxBottom: Math.max(...result.frames.map((f: any) => f.bottom)) }
      results.push({ ...metrics, samples: result.frames })
      console.log('INSTALLED_SAFARI_FOOTER', JSON.stringify({ report, version: created.capabilities.browserVersion, ...metrics }))
      await writeFile(info.outputPath(`safari-${name}.png`), Buffer.from(await command(session + '/screenshot'), 'base64'))
    }
    await execute('scrollTo(0,0)')
    await settle()
    expect(await execute('const v=document.querySelector(".ag-grid-viewport");return v.scrollHeight-v.clientHeight'), 'Collapsed groups must fit in installed Safari too').toBe(0)
    await sample('short-groups', 16, 35)
    await execute('document.querySelector(".ag-row.ag-row-group").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:500,clientY:200}))')
    await wait('return [...document.querySelectorAll("[data-testid=context-action-menu] button")].some(e=>e.textContent.trim()==="Развернуть все")')
    await execute('[...document.querySelectorAll("[data-testid=context-action-menu] button")].find(e=>e.textContent.trim()==="Развернуть все").click()')
    await wait('return Boolean(document.querySelector(".ag-row:not(.ag-row-group)[row-id]")) && !document.querySelector(".journal-loading-cell")')
    await execute('scrollTo(0,500)')
    await settle()
    if (process.env.SAFARI_PIXEL_COMPARISON === '1') {
      await execute(`const style=document.createElement('style');style.id='footer-reference';style.textContent='.journal-page-stage[data-journal-docked-footer]{padding-bottom:0!important}.journal-page-stage[data-journal-docked-footer] > :is(.journal-footer,.document-grid-footer){position:static!important;width:auto!important}';document.head.append(style)`)
      await settle()
      await sample('reference-heading', 40, 20, true)
      await execute('document.querySelector("#footer-reference").remove();scrollTo(0,500)')
      await settle()
    }
    await sample('heading-and-top', 40, 20)
    await writeFile(info.outputPath('safari-footer.json'), JSON.stringify({ report, version: created.capabilities.browserVersion, results }, null, 2))
    for (const result of results) {
      expect(result.frames, 'Capture must include actual rendering frames').toBeGreaterThan(20)
      // A window-only recording can verify the displayed pixels even after
      // focus moves elsewhere. Hidden/locked-window frames remain invalid.
      expect(result.visibleFrames, 'Safari must stay visible for the whole gesture').toBe(result.frames)
      if (!process.env.SAFARI_WINDOW_RECORDER) expect(result.foreground, 'DOM-only measurements require an active Safari window').toBe(true)
      if (result.name.includes('heading')) expect(result.maxY - result.minY, 'The heading must actually move').toBeGreaterThan(30)
      if (result.reference) continue
      expect(result.footerMovement, result.name).toBeLessThanOrEqual(1)
      expect(result.beforeResizeMovement, result.name + ' before stage resize').toBeLessThanOrEqual(1)
    }
  } catch (error) {
    await writeFile(info.outputPath('safari-failure.png'), Buffer.from(await command(session + '/screenshot'), 'base64')).catch(() => {})
    throw error
  }
}
