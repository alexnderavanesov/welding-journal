import { expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { rpcName } from './rpc'

/** Opt-in same-input measurement; no screenshots or geometry reads inside RAF. */
export async function measureJournalMotion(page: Page, browserVersion: string) {
  const label = process.env.JOURNAL_MOTION_LABEL!
  const origin = await page.locator('.journal-page-track').evaluate(el => el.getBoundingClientRect().top + scrollY)
  // Warm the same bounded range before every variant; no server time in timings.
  for (const y of [origin + 6400, origin + 3200, origin + 100]) {
    await page.evaluate(y => scrollTo(0, y), y)
    await page.waitForTimeout(200)
    await expect(page.locator('.journal-loading-cell')).toHaveCount(0)
    await page.waitForLoadState('networkidle')
  }
  await page.mouse.move(1000, 600)
  const calls: string[] = [], errors: string[] = []
  page.on('request', req => { const name = rpcName(req.url()); if (name) calls.push(name) })
  page.on('pageerror', error => errors.push(error.message))
  const samples = []
  for (const direction of ['vertical', 'horizontal']) for (const step of process.env.JOURNAL_MOTION_QUICK || process.env.JOURNAL_MOTION_FAST ? [100] : [12, 100]) for (let repeat = 0; repeat < (process.env.JOURNAL_MOTION_QUICK ? 1 : 3); repeat++) {
    await page.evaluate(y => {
      scrollTo(0, y)
      document.querySelector('.ag-grid-viewport')!.scrollLeft = 0
    }, origin + 100)
    // Measure over real cells by default. The margin option is only for a
    // comparable reference against old builds with the root-overscroll defect.
    await page.mouse.move(direction === 'vertical' && process.env.JOURNAL_MOTION_MARGIN ? 1590 : 1000, 600)
    await page.waitForTimeout(150)
    const beforeCalls = calls.length
    await page.evaluate(() => {
      const state = { running: true, times: [] as number[], longTasks: [] as number[], tileWrites: 0, styleReads: 0 }
      ;(window as any).motionProbe = state
      const original = window.getComputedStyle
      window.getComputedStyle = (...args) => { state.styleReads++; return original(...args) }
      ;(window as any).motionRestore = () => { window.getComputedStyle = original }
      const viewport = document.querySelector<HTMLElement>('.ag-grid-viewport')!
      let tile = viewport.style.getPropertyValue('--journal-gap-image')
      const observer = new MutationObserver(() => {
        const next = viewport.style.getPropertyValue('--journal-gap-image')
        if (tile !== next) { state.tileWrites++; tile = next }
      })
      observer.observe(viewport, { attributes: true, attributeFilter: ['style'] })
      ;(window as any).motionObserver = observer
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        const long = new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(entry => entry.duration)))
        long.observe({ type: 'longtask' }); (window as any).motionLong = long
      }
      const tick = () => { if (state.running) { state.times.push(performance.now()); requestAnimationFrame(tick) } }
      requestAnimationFrame(tick)
    })
    const start = performance.now()
    const positions = []
    for (const sign of [1, -1]) {
      for (let i = 0; i < 50; i++) {
        await page.mouse.wheel(direction === 'horizontal' ? sign * step : 0, direction === 'vertical' ? sign * step : 0)
        await page.waitForTimeout(16)
      }
      positions.push(await page.evaluate(() => ({ x: document.querySelector('.ag-grid-viewport')!.scrollLeft, y: scrollY })))
    }
    await page.waitForTimeout(100)
    const elapsed = performance.now() - start
    const sample = await page.evaluate(() => {
      const s = (window as any).motionProbe; s.running = false
      ;(window as any).motionObserver.disconnect(); (window as any).motionLong?.disconnect(); (window as any).motionRestore()
      const intervals = s.times.slice(1).map((time: number, i: number) => time - s.times[i]).sort((a: number, b: number) => a - b)
      return { frames: s.times.length, p95: intervals[Math.floor(intervals.length * .95)], max: intervals.at(-1), over25: intervals.filter((n: number) => n > 25).length,
        longTasks: s.longTasks, tileWrites: s.tileWrites, styleReads: s.styleReads,
        rows: document.querySelectorAll('.ag-row').length, cells: document.querySelectorAll('.ag-cell').length }
    })
    samples.push({ direction, step, repeat, elapsed, ...sample, positions, origin, requests: calls.slice(beforeCalls) })
    console.log('MOTION_SAMPLE', JSON.stringify(samples.at(-1)))
    expect(positions[0][direction === 'horizontal' ? 'x' : 'y'] - positions[1][direction === 'horizontal' ? 'x' : 'y']).toBeGreaterThan(step * 40)
  }
  const result = { browserVersion, deviceScaleFactor: await page.evaluate(() => devicePixelRatio), cpuThrottle: 1, verticalTarget: process.env.JOURNAL_MOTION_MARGIN ? 'margin' : 'cells', samples, errors }
  await writeFile(`/tmp/journal-motion-${label}.json`, JSON.stringify(result, null, 2))
  console.log('JOURNAL_MOTION', JSON.stringify(result))
  expect(errors).toEqual([])
  expect(samples.flatMap(s => s.requests)).toEqual([])
}
