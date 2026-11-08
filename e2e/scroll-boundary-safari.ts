import { expect, type Page, type TestInfo } from '@playwright/test'
import { authenticateE2eSafari } from './authentication'

/** Opt-in native wheel check in an isolated installed Safari window. WebDriver
 * wheels may lack trackpad momentum phases; record whether bounce occurred. */
export async function checkInstalledSafariBoundaries(page: Page, info: TestInfo) {
  const origin = new URL(page.url())
  if (origin.hostname !== '127.0.0.1' || origin.port !== '3100') throw Error('Requires the disposable local E2E server')
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> => {
    const response = await fetch('http://127.0.0.1:4445' + path, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw Error(JSON.stringify(result.value))
    return result.value
  }
  const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
  const session = '/session/' + created.sessionId
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const settle = () => command(session + '/execute/async', {
    script: 'const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>done(null)))', args: [],
  })
  try {
    await command(session + '/window/rect', { x: 0, y: 0, width: 1400, height: 1000 })
    await authenticateE2eSafari(command, session)
    const results = []
    for (const route of ['/statistics', '/journal']) {
      await command(session + '/url', { url: origin.origin + route })
      if (route === '/statistics') {
        await expect.poll(() => execute('return [...document.querySelectorAll("main button")].some(el=>el.textContent.trim()==="Опоры")')).toBe(true)
        await execute('[...document.querySelectorAll("main button")].find(el=>el.textContent.trim()==="Опоры").click()')
        await expect.poll(() => execute('return document.querySelectorAll("[data-program-page-scroll]").length')).toBeGreaterThan(0)
        await expect.poll(() => execute('return !!document.querySelector("[data-testid=support-statistics]")?.textContent.includes("ELASTIC-A")')).toBe(true)
      } else {
        await expect.poll(() => execute('return !!document.querySelector(".journal-page-track")')).toBe(true)
        await expect.poll(() => execute('return !!document.querySelector(".ag-row:not(.ag-row-loading)") && !document.querySelector(".journal-loading-cell, .journal-footer-update")')).toBe(true)
      }
      await command(session + '/window', { handle: await command(session + '/window') })
      await execute('window.focus()')
      await expect.poll(() => execute('return !document.hidden && document.hasFocus()'), { timeout: 30_000 }).toBe(true)
      for (const edge of ['top', 'bottom']) {
        await execute('scrollTo(0,arguments[0]==="top"?0:document.documentElement.scrollHeight)', edge)
        await settle()
        await execute(`
          const s={running:true,frames:[],writes:[],wheels:0,original:window.scrollTo};window.boundarySample=s;
          s.wheel=()=>s.wheels++;window.addEventListener('wheel',s.wheel,{capture:true,passive:true});
          window.scrollTo=function(...args){s.writes.push(args);return s.original.apply(this,args)};
          const tick=()=>{if(!s.running)return;s.frames.push({y:scrollY,max:Math.max(0,document.documentElement.scrollHeight-innerHeight),height:document.documentElement.scrollHeight,visible:!document.hidden,focused:document.hasFocus()});requestAnimationFrame(tick)};
          requestAnimationFrame(tick);
        `)
        let delta = 0
        const actions: unknown[] = []
        for (let i = 0; i < 12; i++) {
          // SafariDriver uses the difference from the previous wheel state.
          delta += (edge === 'top' ? -1 : 1) * 50
          actions.push({ type: 'scroll', origin: 'viewport', x: 1000, y: 650, deltaX: 0, deltaY: delta, duration: 0 }, { type: 'pause', duration: 40 })
        }
        actions.push({ type: 'pause', duration: 350 })
        await command(session + '/actions', { actions: [{ type: 'wheel', id: route + edge, actions }] })
        const sample = await execute('const s=window.boundarySample;s.running=false;window.scrollTo=s.original;window.removeEventListener("wheel",s.wheel,true);return {frames:s.frames,writes:s.writes,wheels:s.wheels}')
        const metrics = { route, edge, version: created.capabilities.browserVersion, frames: sample.frames.length, wheels: sample.wheels,
          minY: Math.min(...sample.frames.map((f: any) => f.y)), maxY: Math.max(...sample.frames.map((f: any) => f.y)),
          elasticFrames: sample.frames.filter((f: any) => f.y < 0 || f.y > f.max).length,
          heights: [...new Set(sample.frames.map((f: any) => f.height))], writes: sample.writes }
        results.push(metrics)
        console.log('INSTALLED_SAFARI_BOUNDARY', JSON.stringify(metrics))
        expect(sample.frames.length).toBeGreaterThan(10)
        expect(sample.wheels, 'Native wheel input must reach the page').toBeGreaterThan(0)
        expect(sample.frames.every((f: any) => f.visible && f.focused), 'Native wheel check needs an active Safari window').toBe(true)
        expect(sample.writes, 'Native return must not be cancelled by JS').toEqual([])
        expect(metrics.heights).toHaveLength(1)
        await info.attach(`safari-${route.slice(1)}-${edge}`, { body: Buffer.from(await command(session + '/screenshot'), 'base64'), contentType: 'image/png' })
      }
    }
    await info.attach('installed-safari-boundaries', { body: JSON.stringify(results), contentType: 'application/json' })
  } finally {
    await command(session, undefined, 'DELETE')
  }
}
