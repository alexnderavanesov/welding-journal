import { expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { rpcName } from './rpc'

/** Same 18 cards, viewport and columns; only grouping depth changes. */
export async function measureJournalGroupDepth(page: Page, browser: string) {
  const samples: unknown[] = [], errors: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', request => { const name = rpcName(request.url()); if (name) requests.push(name) })
  let added = 0
  const fields = ['line', 'projectTitle', 'subtitleCode', 'groupName', 'category']
  for (const depth of process.env.JOURNAL_DEPTH_SINGLE ? [3] : [0, 1, 3, 5]) {
    await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.ag-grid-viewport')!.scrollLeft = 0 })
    for (; added < depth; added++) {
      await page.locator(`.ag-header-cell[col-id="${fields[added]}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    }
    if (depth) {
      await page.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
      await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
    }
    await expect(page.getByRole('button', { name: 'T01', exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => scrollTo(0, document.querySelector('.journal-page-track')!.getBoundingClientRect().top + scrollY + 380))
    await page.waitForTimeout(300)
    await expect(page.locator('.journal-loading-cell')).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    for (const action of ['horizontal', 'resize']) for (let repeat = 0; repeat < 3; repeat++) {
      await page.evaluate(() => { document.querySelector('.ag-grid-viewport')!.scrollLeft = 0 })
      await page.waitForTimeout(150)
      const before = requests.length
      const handle = await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-resize').boundingBox()
      await page.mouse.move(action === 'resize' ? handle!.x + handle!.width / 2 : 1000, action === 'resize' ? handle!.y + handle!.height / 2 : 600)
      await page.evaluate(profile => {
        const state = { running: true, times: [] as number[], reads: 0, readMs: 0, targets: {} as Record<string, { count: number; stack?: string }> }
        ;(window as any).depthProbe = state
        const original = window.getComputedStyle
        window.getComputedStyle = (...args) => {
          if (profile) { const key = String(args[0].className); const target = state.targets[key] ??= { count: 0, stack: new Error().stack }; target.count++ }
          const start = performance.now(); const value = original(...args); state.readMs += performance.now() - start; state.reads++; return value
        }
        ;(window as any).depthRestore = () => { window.getComputedStyle = original }
        const tick = () => { if (state.running) { state.times.push(performance.now()); requestAnimationFrame(tick) } }
        requestAnimationFrame(tick)
      }, Boolean(process.env.JOURNAL_READ_PROFILE))
      const started = performance.now()
      if (action === 'horizontal') {
        for (const sign of [1, -1]) for (let step = 0; step < 30; step++) { await page.mouse.wheel(sign * 100, 0); await page.waitForTimeout(16) }
      } else {
        await page.mouse.down()
        for (const dx of [180, 0]) await page.mouse.move(handle!.x + handle!.width / 2 + dx, handle!.y + handle!.height / 2, { steps: 90 })
        await page.mouse.up()
      }
      const elapsed = performance.now() - started
      const sample = await page.evaluate(() => {
        const state = (window as any).depthProbe; state.running = false; (window as any).depthRestore()
        const intervals = state.times.slice(1).map((n: number, i: number) => n - state.times[i]).sort((a: number, b: number) => a - b)
        return { frames: state.times.length, p95: intervals[Math.floor(intervals.length * .95)], max: intervals.at(-1), over25: intervals.filter((n: number) => n > 25).length,
          reads: state.reads, readMs: state.readMs, targets: state.targets, rows: document.querySelectorAll('.ag-row').length, groups: document.querySelectorAll('.ag-row-group').length,
          sticky: document.querySelectorAll('.ag-grid-sticky-top-rows-container .ag-row').length, cells: document.querySelectorAll('.ag-cell').length }
      })
      samples.push({ depth, action, repeat, elapsed, ...sample, requests: requests.slice(before) })
      console.log('DEPTH_SAMPLE', JSON.stringify(samples.at(-1)))
      expect(requests.slice(before)).toEqual([])
    }
  }
  expect(errors).toEqual([])
  await writeFile(`/tmp/journal-depth-${process.env.JOURNAL_DEPTH_LABEL}.json`, JSON.stringify({ browser, samples, errors }, null, 2))
}
