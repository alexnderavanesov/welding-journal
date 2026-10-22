import { expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const requireTest = createRequire(createRequire(import.meta.url).resolve('@playwright/test'))
const requirePlaywright = createRequire(requireTest.resolve('playwright'))
const { PNG } = requirePlaywright(join(dirname(requirePlaywright.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'))

/** A/B the underlay on the same build. Real compositor frames, not DOM/RAF
 * snapshots. Busy bursts deliberately expose the finite virtualization buffer. */
export async function captureJournalGaps(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const frames: string[] = []
  cdp.on('Page.screencastFrame', event => {
    frames.push(event.data)
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
  })
  const geometry = await page.evaluate(() => {
    const viewport = document.querySelector('.ag-grid-viewport')!.getBoundingClientRect()
    const row = document.querySelector('.ag-grid-scrolling-rows .ag-row')!.getBoundingClientRect()
    const line = document.querySelector('.ag-header-cell[col-id="line"]')!.getBoundingClientRect()
    return { markerX: Math.round(row.left + 12), barX: Math.round(line.left + 25), height: row.height,
      startY: Math.max(220, Math.ceil(viewport.top + 180)), endY: Math.floor(viewport.bottom - 60) }
  })
  await page.addStyleTag({ content: '.ag-grid-scrolling-rows .ag-row::after { content:""; position:absolute; left:10px; top:11px; width:6px; height:4px; background:rgb(255,0,255) !important; border:0 !important; z-index:10000; pointer-events:none; }' })
  const results: Record<string, unknown> = {}
  for (const enabled of [false, true]) {
    const override = !enabled ? await page.addStyleTag({ content: '.journal-server-section .ag-grid-viewport { background-image:none !important; } .journal-server-section .ag-grid-scrolling-rows { background-color:var(--ag-data-background-color) !important; }' }) : null
    await page.evaluate(() => scrollTo(0, document.querySelector('.journal-page-track')!.getBoundingClientRect().top + scrollY + 700))
    await expect.poll(() => page.locator('.ag-grid-viewport').evaluate(element => element.scrollTop)).toBe(700)
    await page.waitForTimeout(100)
    for (const busy of [false, true]) {
      frames.length = 0
      await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
      if (busy) await page.evaluate(() => {
        ;(window as any).gapBusy = setInterval(() => { const end = performance.now() + 150; while (performance.now() < end) { /* diagnostic only */ } }, 200)
      })
      for (const yDistance of [-4500, 4500]) await cdp.send('Input.synthesizeScrollGesture', { x: 700, y: 500, yDistance, speed: 12000, gestureSourceType: 'mouse' })
      if (busy) await page.evaluate(() => clearInterval((window as any).gapBusy))
      await cdp.send('Page.stopScreencast')
      let gaps = 0, uncovered = 0, saved = false
      for (const frame of frames) {
        const png = PNG.sync.read(Buffer.from(frame, 'base64')) as { width: number; data: Buffer }
        const color = (x: number, y: number) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]] }
        for (let top = geometry.startY; top + geometry.height < geometry.endY; top += geometry.height) {
          let marker = 0, bar = 0
          for (let y = top; y < top + geometry.height; y++) {
            const [r, g, b] = color(geometry.markerX, y)
            if (r > 220 && g < 40 && b > 220) marker++
            const [br, bg, bb] = color(geometry.barX, y)
            if (Math.abs(br - 223) < 2 && Math.abs(bg - 227) < 2 && Math.abs(bb - 230) < 2) bar++
          }
          if (marker) continue
          gaps++
          if (bar < 4) uncovered++
          if (!saved) { await writeFile(`/tmp/journal-real-gap-${enabled ? 'after' : 'before'}-${busy ? 'busy' : 'ordinary'}.png`, Buffer.from(frame, 'base64')); saved = true }
        }
      }
      const result = { frames: frames.length, gapBands: gaps, uncoveredBands: uncovered, coveredBands: gaps - uncovered }
      results[`${enabled ? 'after' : 'before'}-${busy ? 'busy' : 'ordinary'}`] = result
      if (busy) expect(gaps).toBeGreaterThan(0)
      if (enabled) expect(uncovered).toBe(0)
    }
    await override?.evaluate(element => element.parentNode?.removeChild(element))
  }
  await writeFile('/tmp/journal-gap-compositor.json', JSON.stringify(results, null, 2))
  console.log('COMPOSITED_GAPS', JSON.stringify(results))
  await cdp.detach()
}
