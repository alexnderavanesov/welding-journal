import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { prepareSafariMeasurementWindow } from '../safari-foreground'

test.use({ trace: 'off', video: 'off' })

test('installed Safari: fresh sessions, twenty refreshes and twenty returns on the isolated local server', async ({}, info) => {
  test.skip(!process.env.AUDIT_SAFARI_STARTUP_LABEL, 'Requires the separate installed SafariDriver automation window')
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  test.setTimeout(300_000)
  const origin = new URL(String(info.project.use.baseURL))
  expect([origin.hostname, origin.port]).toEqual(['127.0.0.1', '3100'])
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch('http://127.0.0.1:4445' + path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000),
    })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result.value))
    return result.value
  }
  const samples: unknown[] = [], versions: string[] = []
  for (let cold = 0; cold < 3; cold++) {
    const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari', pageLoadStrategy: 'eager' } } })
    versions.push(created.capabilities.browserVersion)
    const session = '/session/' + created.sessionId
    const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
    const wait = (script: string) => expect.poll(() => execute(script), { timeout: 30_000 }).toBe(true)
    try {
      await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
      const ownHandle = await command(session + '/window')
      await command(session + '/window', { handle: ownHandle })
      await prepareSafariMeasurementWindow(command, session)
      const run = async (phase: string, round: number, action: () => Promise<unknown>, navigation: boolean) => {
        const token = `${cold}:${phase}:${round}`
        await execute('window.startupPreviousDocument=arguments[0]', token)
        const start = performance.now()
        let shell: number | null = null, grid: number | null = null, ready: number | null = null
        await action()
        await expect.poll(async () => {
          const sample = await execute(`
            if(location.pathname!=='/journal'||(arguments[1]&&window.startupPreviousDocument===arguments[0]))return null;
            const frame=document.querySelector('.journal-grid-frame');
            return {shell:!!document.querySelector('input[aria-label="Быстрый поиск по отчету"]'),grid:!!frame,
              ready:frame?.getAttribute('aria-busy')==='false'&&!!frame.querySelector('.ag-row[row-id]')};
          `, token, navigation)
          if (!sample) return false
          const elapsed = performance.now() - start
          if (sample.shell && shell === null) shell = elapsed
          if (sample.grid && grid === null) grid = elapsed
          if (sample.ready && ready === null) ready = elapsed
          return ready !== null
        }, { timeout: 30_000, intervals: [10, 20, 30, 50] }).toBe(true)
        const metrics = await execute(`
          const nav=performance.getEntriesByType('navigation')[0];
          const resources=performance.getEntriesByType('resource').filter(e=>e.startTime>=(window.startupRouteStarted||0));
          return {navigation:arguments[0]?{ttfbMs:nav.responseStart,htmlCompleteMs:nav.responseEnd,
            domContentLoadedMs:nav.domContentLoadedEventEnd,firstContentfulPaintMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null}:null,
            resources:resources.map(e=>({name:new URL(e.name).pathname,durationMs:e.duration,
              transferBytes:e.transferSize,encodedBytes:e.encodedBodySize,decodedBytes:e.decodedBodySize})),
            domNodes:document.querySelectorAll('*').length,visible:!document.hidden,documentFocused:document.hasFocus(),
            viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};
        `, navigation)
        // Safari can leave focus in its address bar after navigation. Visible
        // painting remains valid; keyboard/motion tests require document focus.
        expect(metrics.visible).toBe(true)
        samples.push({ cold, phase, round, observedShellMs: shell, observedGridMs: grid, observedReadyMs: ready, ...metrics })
      }
      // A new automation session is not asserted to have a cold disk cache.
      // Retain actual ResourceTiming bytes and distinguish these from Chrome's
      // explicit fresh contexts. UI timings are polling upper bounds; navigation
      // and paint timestamps below come from the browser's own performance clock.
      await run('fresh-automation-session', cold, () => command(session + '/url', { url: origin.origin + '/journal' }), true)
      if (cold !== 2) continue
      for (let round = 0; round < 20; round++) await run('warm-refresh', round, () => command(session + '/refresh', {}), true)
      for (let round = 0; round < 20; round++) {
        await execute('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="ЛНК").click()')
        await wait('return location.pathname==="/lnk"&&document.querySelector(".journal-grid-frame")?.getAttribute("aria-busy")==="false"')
        await execute('window.startupRouteStarted=performance.now();performance.clearResourceTimings()')
        await run('warm-route-return', round, () => execute('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Сварочный журнал").click()'), false)
      }
    } catch (error) {
      const diagnostic = await execute(`return {url:location.href,readyState:document.readyState,hidden:document.hidden,focus:document.hasFocus(),
        text:document.body?.innerText,previous:window.startupPreviousDocument,
        frames:[...document.querySelectorAll('.journal-grid-frame')].map(e=>({busy:e.getAttribute('aria-busy'),rows:e.querySelectorAll('.ag-row[row-id]').length})),
        resources:performance.getEntriesByType('resource').map(e=>({name:e.name,duration:e.duration,bytes:e.transferSize}))}`)
      await writeFile(info.outputPath('safari-startup-failure.json'), JSON.stringify({ cold, samples, diagnostic }, null, 2))
      const screenshot = await command(session + '/screenshot')
      await writeFile(info.outputPath('safari-startup-failure.png'), Buffer.from(screenshot, 'base64'))
      throw error
    } finally {
      await command(session, undefined, 'DELETE')
    }
  }
  const result = { browser: 'installed Safari', versions, cpuThrottling: 'none',
    uiTiming: 'WebDriver polling upper bounds, 10–50ms target intervals plus command latency', samples }
  await writeFile(info.outputPath(`startup-safari-${process.env.AUDIT_SAFARI_STARTUP_LABEL}.json`), JSON.stringify(result, null, 2))
  console.log('SAFARI_STARTUP_AUDIT', JSON.stringify(result))
})
