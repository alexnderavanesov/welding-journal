import type { Page, Request } from '@playwright/test'
import { deserializeRpcPayload, rpcName } from './rpc'

export type OpeningSurface = {
  name: string
  path: string
  root: string
  frame: string
  leaf: string
  footer: string
}

type Probe = {
  started: number
  gridMs: number | null
  firstRowMs: number | null
  readyAfterTransitionMs: number | null
  summaryMs: number | null
  busySeen: boolean
  gridMounts: number
  frames: number[]
  longTasks: Array<{ startMs: number; durationMs: number }>
  inspect: () => void
  stop: () => void
}

/** Same low-cost observer on both bundles; no app API/Fiber access or layout reads. */
export function installOpeningProbe(surface: OpeningSurface) {
  const holder = window as unknown as { deepOpeningProbe?: Probe; resetDeepOpeningProbe?: () => void }
  holder.resetDeepOpeningProbe = () => {
    holder.deepOpeningProbe?.stop()
    const initialFrame = document.querySelector(surface.frame)
    const initialRow = document.querySelector(surface.root)?.querySelector('.ag-row[row-id]:not(.ag-row-loading)')
    const initialLeaf = document.querySelector(surface.root)?.querySelector(surface.leaf)
    const seen = new WeakSet<Element>()
    if (initialFrame) seen.add(initialFrame)
    let raf = 0
    const probe: Probe = {
      started: holder.deepOpeningProbe ? performance.now() : 0, gridMs: null, firstRowMs: null, readyAfterTransitionMs: null,
      summaryMs: null, busySeen: false, gridMounts: 0, frames: [], longTasks: [],
      inspect: () => {}, stop: () => {},
    }
    const inspect = () => {
      if (location.pathname !== surface.path) return
      const now = performance.now() - probe.started
      const root = document.querySelector(surface.root), frame = document.querySelector(surface.frame)
      if (!root || !frame) return
      if (!seen.has(frame)) { seen.add(frame); probe.gridMounts++ }
      if (probe.gridMs === null) probe.gridMs = now
      const leaf = root.querySelector(surface.leaf)
      if (leaf && probe.firstRowMs === null) probe.firstRowMs = now
      const busy = frame.getAttribute('aria-busy') === 'true' || frame.hasAttribute('data-journal-updating')
      probe.busySeen ||= busy
      // Existing rows before an action are not a new ready result. The spec
      // additionally verifies the expected row/count/group outside this probe.
      const row = root.querySelector('.ag-row[row-id]:not(.ag-row-loading)')
      const transitioned = !initialFrame || frame !== initialFrame || probe.busySeen || Boolean(row && row !== initialRow) || Boolean(leaf && leaf !== initialLeaf)
      if (transitioned && !busy && row && !root.querySelector('.ag-row-loading') && probe.readyAfterTransitionMs === null) probe.readyAfterTransitionMs = now
      const footer = root.querySelector(surface.footer)?.textContent ?? ''
      if (transitioned && !busy && root.querySelector('.ag-row[row-id]:not(.ag-row-loading)') && /Найдено:\s*[\d\s]+/.test(footer) && !/Подсчёт|Загрузка…/.test(footer) && probe.summaryMs === null) probe.summaryMs = now
    }
    const observer = new MutationObserver(inspect)
    observer.observe(document, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'data-journal-updating'] })
    const long = PerformanceObserver.supportedEntryTypes.includes('longtask') ? new PerformanceObserver(list => {
      probe.longTasks.push(...list.getEntries().map(entry => ({ startMs: entry.startTime - probe.started, durationMs: entry.duration })))
    }) : null
    long?.observe({ type: 'longtask' })
    const tick = () => { probe.frames.push(performance.now()); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    probe.inspect = inspect
    probe.stop = () => { observer.disconnect(); long?.disconnect(); cancelAnimationFrame(raf) }
    holder.deepOpeningProbe = probe
  }
  holder.resetDeepOpeningProbe()
}

export async function createOpeningRecorder(page: Page, surface: OpeningSurface) {
  await page.addInitScript(installOpeningProbe, surface)
  const cdp = page.context().browser()?.browserType().name() === 'chromium'
    ? await page.context().newCDPSession(page) : null
  await cdp?.send('Performance.enable')
  const metrics = async () => Object.fromEntries((await cdp?.send('Performance.getMetrics'))?.metrics.map(item => [item.name, item.value]) ?? [])
  const errors: string[] = [], requests: Array<{ request: Request; name: string; start: number; end?: number; status?: number; failure?: string }> = []
  const requestIndex = new Map<Request, number>()
  const pageError = (error: Error) => errors.push(error.message)
  const request = (req: Request) => {
    const name = rpcName(req.url())
    if (!name) return
    requestIndex.set(req, requests.length)
    requests.push({ request: req, name, start: performance.now() })
  }
  const finished = (req: Request) => {
    const index = requestIndex.get(req)
    if (index !== undefined) requests[index].end = performance.now()
  }
  const failed = (req: Request) => {
    finished(req)
    const index = requestIndex.get(req)
    if (index !== undefined) requests[index].failure = req.failure()?.errorText
  }
  page.on('pageerror', pageError); page.on('request', request)
  page.on('requestfinished', finished); page.on('requestfailed', failed)
  const samples: object[] = []
  const measure = async (phase: string, round: number, action: () => Promise<unknown>, rowsReady: () => Promise<unknown>, summaryReady: () => Promise<unknown>) => {
    console.log('DEEP_OPENING_PHASE', JSON.stringify({ surface: surface.name, phase, round, state: 'start' }))
    if (page.url() !== 'about:blank') await page.evaluate(() => {
      performance.clearResourceTimings()
      ;(window as unknown as { resetDeepOpeningProbe?: () => void }).resetDeepOpeningProbe?.()
    })
    const before = await metrics(), start = performance.now(), from = requests.length
    await action()
    console.log('DEEP_OPENING_PHASE', JSON.stringify({ surface: surface.name, phase, round, state: 'action-complete', milliseconds: performance.now() - start }))
    await rowsReady()
    const observedRowsReadyMs = performance.now() - start
    console.log('DEEP_OPENING_PHASE', JSON.stringify({ surface: surface.name, phase, round, state: 'rows-ready', milliseconds: observedRowsReadyMs }))
    await summaryReady()
    const observedSummaryReadyMs = performance.now() - start
    const after = await metrics()
    await page.evaluate(() => {
      const probe = (window as unknown as { deepOpeningProbe: Probe }).deepOpeningProbe
      probe.inspect(); probe.stop()
    })
    // Resource completion and diagnostic deserialization are outside the
    // measured readiness. Never route/intercept: that disables HTTP caching.
    await page.waitForLoadState('networkidle')
    const browser = await page.evaluate(() => {
      const probe = (window as unknown as { deepOpeningProbe: Probe }).deepOpeningProbe
      const intervals = probe.frames.slice(1).map((time, i) => time - probe.frames[i]).sort((a, b) => a - b)
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      return {
        gridMs: probe.gridMs, firstRowMs: probe.firstRowMs, readyAfterTransitionMs: probe.readyAfterTransitionMs,
        summaryMs: probe.summaryMs, busySeen: probe.busySeen, gridMounts: probe.gridMounts,
        // RAF intervals are scheduling observations, not physical display FPS.
        raf: { count: intervals.length, p95Ms: intervals[Math.floor(intervals.length * .95)] ?? null, maxMs: intervals.at(-1) ?? null },
        longTasks: probe.longTasks,
        navigation: nav && probe.started === 0 ? { ttfbMs: nav.responseStart, htmlCompleteMs: nav.responseEnd, domContentLoadedMs: nav.domContentLoadedEventEnd,
          transferBytes: nav.transferSize, type: nav.type } : null,
        resources: (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
          .filter(entry => entry.startTime >= probe.started)
          .map(entry => ({ path: new URL(entry.name).pathname, startMs: entry.startTime - probe.started, responseEndMs: entry.responseEnd - probe.started,
            durationMs: entry.duration, transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize,
            initiatorType: entry.initiatorType })),
        domNodes: document.querySelectorAll('*').length,
      }
    })
    const calls = await Promise.all(requests.slice(from).map(async call => {
      let data: unknown
      try {
        const body = call.request.postData()
        const encoded = body ?? new URL(call.request.url()).searchParams.get('payload')
        data = encoded ? deserializeRpcPayload(encoded) : undefined
      } catch { /* Transport details remain available through timing/name. */ }
      return { name: call.name, startMs: call.start - start, finishMs: call.end === undefined ? null : call.end - start,
        status: (await call.request.response())?.status(), failure: call.failure, data }
    }))
    const navigated = before.NavigationStart !== after.NavigationStart
    const counters = (values: Record<string, number>) => ({ navigationStart: values.NavigationStart,
      scriptMs: values.ScriptDuration * 1000, layoutMs: values.LayoutDuration * 1000, styleMs: values.RecalcStyleDuration * 1000 })
    const sample = { surface: surface.name, phase, round, observedRowsReadyMs, observedSummaryReadyMs, ...browser,
      // CDP counters can cross a renderer/document reset on reload. Preserve
      // raw endpoints; only same-document SPA deltas are labelled phase cost.
      cdp: cdp ? { before: counters(before), after: counters(after), navigated,
        sameDocumentDelta: navigated ? null : { scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
          layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000, styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000 } } : null,
      requests: calls }
    samples.push(sample)
    console.log('DEEP_OPENING_PHASE', JSON.stringify({ surface: surface.name, phase, round, state: 'complete',
      observedRowsReadyMs, observedSummaryReadyMs, calls: calls.map(call => call.name) }))
    return sample
  }
  return { samples, errors, measure, dispose: async () => {
    page.off('pageerror', pageError); page.off('request', request)
    page.off('requestfinished', finished); page.off('requestfailed', failed)
    try { await cdp?.detach() } catch (error) { if (!page.isClosed()) throw error }
  } }
}
