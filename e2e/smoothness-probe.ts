import { expect, type Page, type TestInfo, type Locator, type Request } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { rpcName } from './rpc'
import { auditSqlCount, auditSqlDetails } from './audit-sql'

// Opt-in diagnostics, never imported by the application. No DOM reads in RAF.
function install() {
  const state = { active: true, last: 0, frames: [] as number[], longTasks: [] as number[] }
  const tick = (time: number) => {
    if (state.active && state.last && state.frames.length < 10000) state.frames.push(time - state.last)
    state.last = state.active ? time : 0
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
    if (state.active) state.longTasks.push(...list.getEntries().map(entry => entry.duration))
  }).observe({ type: 'longtask' })
  Object.assign(window, { smoothnessProbe: state })
}
type State = { active: boolean; last: number; frames: number[]; longTasks: number[] }

export async function createSmoothnessProbe(page: Page, info: TestInfo) {
  const cdp = page.context().browser()?.browserType().name() === 'chromium' ? await page.context().newCDPSession(page) : null
  await cdp?.send('Performance.enable')
  await page.addInitScript(install)
  await page.evaluate(install)
  const requests: { name: string; at: number }[] = [], errors: string[] = [], samples: object[] = []
  const pending = new Set<Request>()
  page.on('request', request => pending.add(request))
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) requests.push({ name: rpcName(request.url()), at: performance.now() }) })
  page.on('pageerror', error => errors.push(error.message))
  const metrics = async () => Object.fromEntries((await cdp?.send('Performance.getMetrics'))?.metrics.map(item => [item.name, item.value]) ?? [])
  const save = () => writeFile(info.outputPath('smoothness.json'), JSON.stringify({ label: process.env.SMOOTHNESS_LABEL, browser: info.project.name,
    version: page.context().browser()?.version(), viewport: page.viewportSize(), cpuThrottling: 'none', samples, errors }, null, 2))
  const measure = async (name: string, run: () => Promise<unknown>, interaction?: object) => {
    const sqlBefore = (await auditSqlDetails())?.statements, before = await metrics(), first = requests.length
    const timeOriginBefore = await page.evaluate(() => performance.timeOrigin)
    await page.evaluate(() => {
      const state = (window as unknown as { smoothnessProbe: State }).smoothnessProbe
      Object.assign(state, { active: true, last: 0, frames: [], longTasks: [] })
    })
    const started = performance.now()
    try {
      await run()
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const readyMs = performance.now() - started, after = await metrics()
      const render = await page.evaluate(() => {
        const state = (window as unknown as { smoothnessProbe: State }).smoothnessProbe
        state.active = false
        const frames = state.frames.slice(1).sort((a, b) => a - b)
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        return { frameCount: frames.length, p95FrameMs: frames[Math.floor(frames.length * .95)] ?? null,
          maxFrameMs: frames.at(-1) ?? null, framesOver33Ms: frames.filter(n => n > 33).length,
          longTasksMs: state.longTasks, domNodes: document.querySelectorAll('*').length,
          renderedGridRows: document.querySelectorAll('.ag-row').length, hidden: document.hidden, timeOrigin: performance.timeOrigin,
          jsHeapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize,
          navigation: navigation ? { ttfbMs: navigation.responseStart, htmlMs: navigation.responseEnd, domContentLoadedMs: navigation.domContentLoadedEventEnd } : null }
      })
      // Readiness above belongs to the actual UI action. A preview iframe or
      // background activity must not turn this diagnostic settle into an
      // unbounded wait after the useful result has already appeared.
      let networkSettled = true
      try { await page.waitForLoadState('networkidle', { timeout: 2000 }) }
      catch (error) { if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error; networkSettled = false }
      const pendingResources = [...pending].map(request => {
        const url = new URL(request.url())
        return { resourceType: request.resourceType(), resource: `${url.origin}${url.pathname}` }
      })
      const sqlAfter = await auditSqlCount()
      samples.push({ name, readyMs, ...render, interaction, networkSettled, pendingResources, requests: requests.slice(first).map(request => ({ name: request.name, startedMs: request.at - started })),
        sqlStatements: sqlBefore !== undefined && sqlAfter !== undefined ? sqlAfter - sqlBefore : null,
        scriptMs: cdp ? Math.max(0, after.ScriptDuration - (render.timeOrigin === timeOriginBefore ? before.ScriptDuration : 0)) * 1000 : null,
        layoutMs: cdp ? Math.max(0, after.LayoutDuration - (render.timeOrigin === timeOriginBefore ? before.LayoutDuration : 0)) * 1000 : null,
        styleMs: cdp ? Math.max(0, after.RecalcStyleDuration - (render.timeOrigin === timeOriginBefore ? before.RecalcStyleDuration : 0)) * 1000 : null })
      await save()
      expect(render.hidden, `Measurement must run in a visible page: ${name}`).toBe(false)
      expect(errors).toEqual([])
    } catch (error) {
      samples.push({ name, failed: true, elapsedMs: performance.now() - started, interaction, message: String(error),
        requests: requests.slice(first).map(request => ({ name: request.name, startedMs: request.at - started })) })
      await save()
      throw error
    }
  }
  const scroll = async (name: string, surface: Locator, horizontal = false) => {
    await surface.scrollIntoViewIfNeeded()
    // Resolve geometry once, outside the timed gesture. A page-scroll grid can
    // have a huge/negative bounding box while its real scroll owner is document.
    // Dialogs, virtual lists and normal grids instead own their own scroll area.
    const plan = await surface.evaluateHandle((element, horizontal) => {
      const root = document.scrollingElement as HTMLElement
      const describe = (node: Element) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${Array.from(node.classList).slice(0, 4).map(name => `.${name}`).join('')}`
      const range = (node: Element) => horizontal ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight
      const offset = (node: Element) => horizontal ? node.scrollLeft : node.scrollTop
      const mainViewportPoint = (x: number, y: number) => {
        let currentWindow: Window = window
        // Preview sheets live inside same-origin iframes. Local elementFromPoint
        // is insufficient if a parent overlay covers the frame at that point.
        while (currentWindow !== currentWindow.top) {
          const frame = currentWindow.frameElement as HTMLElement | null
          if (!frame) throw new Error('The scroll probe needs an accessible iframe element to translate the wheel target.')
          const rect = frame.getBoundingClientRect()
          const scaleX = rect.width / frame.offsetWidth, scaleY = rect.height / frame.offsetHeight
          x = rect.left + (frame.clientLeft + x) * scaleX
          y = rect.top + (frame.clientTop + y) * scaleY
          currentWindow = currentWindow.parent
          if (currentWindow.document.elementFromPoint(x, y) !== frame) return null
        }
        return { x, y }
      }
      const scrollable = (node: Element) => {
        // AG autoHeight expands into the page. A nested detail can temporarily
        // contribute scrollHeight to this viewport, but it is not the vertical
        // wheel owner (the page adapter handles that gesture).
        if (!horizontal && node.matches('.ag-grid-viewport.ag-layout-auto-height')) return false
        const style = getComputedStyle(node), overflow = horizontal ? style.overflowX : style.overflowY
        return range(node) > 1 && (node === root ? !/hidden|clip/.test(overflow) : /auto|scroll|overlay/.test(overflow))
      }
      const candidates = new Set<Element>([element, ...element.querySelectorAll('*')])
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) candidates.add(ancestor)
      const surfaceBox = element.getBoundingClientRect()
      const choices: { owner: HTMLElement; point: { x: number; y: number }; area: number }[] = []
      let overflowCandidates = 0
      for (const candidate of candidates) {
        if (!scrollable(candidate)) continue
        const rect = candidate === root ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : candidate.getBoundingClientRect()
        const left = Math.max(0, surfaceBox.left, rect.left), right = Math.min(innerWidth, surfaceBox.right, rect.right)
        const top = Math.max(0, surfaceBox.top, rect.top), bottom = Math.min(innerHeight, surfaceBox.bottom, rect.bottom)
        if (right - left < 4 || bottom - top < 4) continue
        overflowCandidates++
        let point: { x: number; y: number } | undefined
        for (const yf of [.5, .75, .25]) {
          for (const xf of [.5, .75, .25]) {
            const x = left + (right - left) * xf, y = top + (bottom - top) * yf
            const hit = document.elementFromPoint(x, y)
            if (!hit || !element.contains(hit) || !candidate.contains(hit)) continue
            // An inner list can intercept the wheel even when a dialog or page
            // behind it also has overflow. Measure the closest actual owner.
            let nearest: Element | null = hit
            while (nearest && !scrollable(nearest)) nearest = nearest.parentElement
            if (nearest !== candidate) continue
            const mainPoint = mainViewportPoint(x, y)
            if (!mainPoint) continue
            point = mainPoint; break
          }
          if (point) break
        }
        if (point) choices.push({ owner: candidate as HTMLElement, point, area: (right - left) * (bottom - top) })
      }
      choices.sort((a, b) => b.area - a.area)
      const choice = choices[0]
      if (!choice && overflowCandidates) throw new Error('Scrollable content exists but no unobstructed wheel target was found; use a more specific scroll surface.')
      return { owner: choice?.owner ?? null, point: choice?.point ?? null,
        ownerLabel: choice ? `${window !== window.top ? 'iframe:' : ''}${choice.owner === root ? 'document.scrollingElement' : describe(choice.owner)}` : null,
        surface: describe(element), range: choice ? range(choice.owner) : 0, start: choice ? offset(choice.owner) : 0 }
    }, horizontal)
    const owner = (await plan.getProperty('owner')).asElement()
    const interaction = await plan.evaluate(({ owner: _owner, ...details }, horizontal) => ({ type: 'scroll', axis: horizontal ? 'horizontal' : 'vertical', ...details,
      outcome: _owner ? 'pending' : 'no-overflow', midpoint: null as number | null, end: null as number | null, amplitude: 0 }), horizontal)
    try {
      if (!owner || !interaction.point) {
        await measure(name, async () => {}, interaction)
        return
      }
      await page.mouse.move(interaction.point.x, interaction.point.y)
      await measure(name, async () => {
        interaction.start = await owner.evaluate((element, horizontal) => horizontal ? element.scrollLeft : element.scrollTop, horizontal)
        const direction = interaction.range - interaction.start >= interaction.start ? 1 : -1
        for (const leg of [direction, -direction]) {
          for (let step = 0; step < 16; step++) {
            await page.mouse.wheel(horizontal ? leg * 100 : 0, horizontal ? 0 : leg * 100)
            await page.waitForTimeout(16)
          }
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
          const position = await owner.evaluate((element, horizontal) => horizontal ? element.scrollLeft : element.scrollTop, horizontal)
          if (interaction.midpoint === null) {
            interaction.midpoint = position
            interaction.amplitude = Math.abs(position - interaction.start)
            expect(interaction.amplitude, `${name}: wheel must move ${interaction.ownerLabel}`).toBeGreaterThan(1)
          } else interaction.end = position
        }
        interaction.outcome = 'scrolled'
      }, interaction)
    } finally { await owner?.dispose(); await plan.dispose() }
  }
  const resize = async (name: string, grid: Locator, column?: string) => {
    const header = column ? grid.locator(`.ag-header-cell[col-id="${column}"]`).first() : grid.locator('.ag-header-cell').filter({ has: page.locator('.ag-header-cell-resize:visible') }).first()
    await header.scrollIntoViewIfNeeded()
    const handle = header.locator('.ag-header-cell-resize'), box = (await handle.boundingBox())!, width = (await header.boundingBox())!.width
    const interaction = { type: 'resize', column: await header.getAttribute('col-id'), startWidth: width, midpointWidth: null as number | null, endWidth: null as number | null }
    await measure(name, async () => {
      const x = box.x + box.width / 2, y = box.y + box.height / 2
      await page.mouse.move(x, y); await page.mouse.down()
      try {
        await page.mouse.move(x + (x + 80 < (page.viewportSize()?.width ?? Infinity) ? 80 : -80), y, { steps: 40 })
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        interaction.midpointWidth = (await header.boundingBox())!.width
        expect(Math.abs(interaction.midpointWidth - width), `${name}: grip must change column width before returning`).toBeGreaterThan(1)
        await page.mouse.move(x, y, { steps: 40 })
      } finally { await page.mouse.up() }
      await expect.poll(async () => Math.abs((await header.boundingBox())!.width - width)).toBeLessThan(2)
      interaction.endWidth = (await header.boundingBox())!.width
    }, interaction)
  }
  const finish = async () => { await save(); await cdp?.detach().catch(() => {}) }
  return { measure, scroll, resize, finish }
}
