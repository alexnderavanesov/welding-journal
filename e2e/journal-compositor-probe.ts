import { expect, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const testRequire = createRequire(createRequire(import.meta.url).resolve('@playwright/test'))
const playwrightRequire = createRequire(testRequire.resolve('playwright'))
const { PNG } = playwrightRequire(join(dirname(playwrightRequire.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'))

/** Compare actual composited pixels against a document-native ruler, rather
 * than sampling scrollTop in RAF (which cannot see a missed compositor frame). */
export async function journalCompositorProbe(page: Page, info: TestInfo, grouped = false) {
  const cdp = await page.context().newCDPSession(page)
  await page.evaluate(() => {
    const track = document.querySelector('.journal-page-track')!
    scrollTo(0, track.getBoundingClientRect().top + scrollY + 320)
  })
  await expect.poll(() => page.locator('.ag-grid-viewport').evaluate(element => element.scrollTop)).toBe(320)
  const geometry = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('.ag-grid-scrolling-rows .ag-row')!
    const rect = row.getBoundingClientRect(), height = rect.height
    const origin = rect.top + scrollY - Number(row.getAttribute('row-index')) * height
    const style = document.createElement('style')
    style.textContent = '.ag-grid-scrolling-rows .ag-row::after { content:""; position:absolute; left:10px; top:11px; width:6px; height:4px; background:rgb(255,0,255) !important; border:0 !important; z-index:10000; pointer-events:none; }'
    document.head.append(style)
    const ruler = document.createElement('div')
    Object.assign(ruler.style, { position: 'absolute', top: `${origin + 11}px`, left: `${rect.left + 24}px`, width: '6px',
      height: `${document.documentElement.scrollHeight - origin - 12}px`, pointerEvents: 'none', zIndex: '10001',
      background: `repeating-linear-gradient(to bottom, rgb(255,0,255) 0px 4px, transparent 4px ${height}px)` })
    document.body.append(ruler)
    return { nativeX: Math.round(rect.left + 26), gridX: Math.round(rect.left + 12), height }
  })
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const frames: { data: string; timestamp: number }[] = []
  cdp.on('Page.screencastFrame', event => {
    frames.push({ data: event.data, timestamp: event.metadata.timestamp! })
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
  })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  // The ordinary CPU run is followed by short, deterministic busy bursts. The
  // latter proves that native movement is independent of JS scheduling; it is
  // a diagnostic, not a claim about normal application workload or server CPU.
  const ordinaryStart = frames.length
  for (const yDistance of [-900, 900]) await cdp.send('Input.synthesizeScrollGesture', {
    x: 750, y: 500, yDistance, speed: 800, gestureSourceType: 'mouse',
  })
  const ordinaryEnd = frames.length
  await page.evaluate(() => {
    ;(window as any).compositorBusy = setInterval(() => { const until = performance.now() + 28; while (performance.now() < until) { /* diagnostic */ } }, 90)
  })
  for (const yDistance of [-900, 900]) await cdp.send('Input.synthesizeScrollGesture', {
    x: 750, y: 500, yDistance, speed: 800, gestureSourceType: 'mouse',
  })
  await page.evaluate(() => clearInterval((window as any).compositorBusy))
  await cdp.send('Page.stopScreencast')
  const samples: { shift: number; error: number; timestamp: number; markers: number }[] = []
  const sampleTop = grouped ? 360 : 200 // Below all three sticky group levels.
  for (const frame of frames) {
    const image = PNG.sync.read(Buffer.from(frame.data, 'base64')) as { width: number; height: number; data: Buffer }
    const pixels = image.data
    const color = (x: number, y: number) => { const i = (y * image.width + x) * 4; return pixels[i] > 220 && pixels[i + 1] < 40 && pixels[i + 2] > 220 ? 1 : 0 }
    let best = Infinity, shift = 0, markers = 0
    for (let y = sampleTop; y < image.height - 100; y++) markers += color(geometry.gridX, y)
    for (let delta = -Math.floor(geometry.height / 2); delta <= Math.floor(geometry.height / 2); delta++) {
      let error = 0
      for (let y = sampleTop; y < image.height - 100; y++) error += Math.abs(color(geometry.gridX, y + delta) - color(geometry.nativeX, y))
      if (error < best) { best = error; shift = delta }
    }
    samples.push({ shift, error: best, timestamp: frame.timestamp, markers })
  }
  const summarize = (rows: typeof samples) => ({ frames: rows.length, driftFrames: rows.filter(row => Math.abs(row.shift) > 1).length,
    maxDrift: Math.max(...rows.map(row => Math.abs(row.shift))), missing: rows.filter(row => row.markers < 20).length })
  const result = { ordinary: summarize(samples.slice(ordinaryStart, ordinaryEnd)), busy: summarize(samples.slice(ordinaryEnd)), geometry, samples }
  const label = (process.env.JOURNAL_COMPOSITOR_LABEL ?? 'before') + (grouped ? '-grouped' : '')
  await writeFile(`/tmp/journal-compositor-${label}.json`, JSON.stringify(result))
  const bad = samples.findIndex(row => Math.abs(row.shift) > 1)
  if (bad >= 0) await writeFile(`/tmp/journal-compositor-${label}.png`, Buffer.from(frames[bad].data, 'base64'))
  await info.attach('composited-frames.json', { body: JSON.stringify(result), contentType: 'application/json' })
  console.log('COMPOSITOR', JSON.stringify({ ordinary: result.ordinary, busy: result.busy }))
  await cdp.detach()
  expect(result.ordinary.frames).toBeGreaterThan(30)
  expect(result.ordinary.missing).toBe(0)
  if (/^(after|final)/.test(label)) { expect(result.ordinary.driftFrames).toBe(0); expect(result.busy.driftFrames).toBe(0) }
}
