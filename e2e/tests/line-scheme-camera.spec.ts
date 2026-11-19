import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, test } from '@playwright/test'

// Real browser layout/scroll rounding, using the actual camera and CSS. No PDF
// worker or server data is involved, so this isolates motion from render speed.
const cameraScript = ts.transpileModule(readFileSync(process.env.E2E_PDF_CAMERA_SOURCE ?? 'src/lib/line-scheme-pdf-camera.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const css = readFileSync('src/components/line-schemes.css', 'utf8')

for (const text of [false, true]) test(`PDF: 500 markers retain geometry during zoom, text ${text}`, async ({ page }, info) => {
  test.skip(text && !!process.env.E2E_PDF_CAMERA_SOURCE, 'The previous camera has no text markers.')
  // A bounded DOM model of 50 leaders. Real component interaction is covered in line-scheme-text.
  const leadersMarkup = text ? `<svg width="100%" height="100%" viewBox="0 0 842 595"><defs><marker id="benchmark-tip" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 6 3 L 0 6 Z" fill="#111827" /></marker></defs>${Array.from({ length: 50 }, (_, n) => `<path d="M ${(0.1 + (n % 25) / 32) * 842} ${(0.1 + Math.floor(n / 25) / 26) * 595} L ${.8 * 842} ${.9 * 595}" fill="none" stroke="#111827" stroke-width="1" marker-end="url(#benchmark-tip)" />`).join('')}</svg>` : ''
  await page.setContent(`<style>${css}</style><div class="line-scheme-pdf" style="width:1000px;height:680px"><div class="line-scheme-pdf-stage"><div class="line-scheme-pdf-space"><div class="line-scheme-pdf-sheet"></div></div></div></div>`)
  await page.addScriptTag({ content: `(() => { const exports = {}; ${cameraScript}
    const stage = document.querySelector('.line-scheme-pdf-stage'), space = document.querySelector('.line-scheme-pdf-space'), sheet = document.querySelector('.line-scheme-pdf-sheet');
    window.pdfCamera = exports.createPdfCamera(stage, space, sheet, {width:842,height:595}, 0, () => {});
    for (let n = 0; n < 500; n++) {
      const element = document.createElement('button'); element.className = 'line-scheme-annotation';
      const point = {x: .1 + (n % 25) / 32, y: .1 + Math.floor(n / 25) / 26};
      if (${text} && n < 50) { element.classList.add('line-scheme-text'); element.style.fontSize = '11px'; element.textContent = 'Примечание ' + n + '\\nПосле монтажа'; point.textRotation = 0; }
      else { element.textContent = 'S' + n; element.style.width = '24px'; element.style.height = '24px'; }
      sheet.append(element); window.pdfCamera.trackMarker(element, point);
    }
    sheet.insertAdjacentHTML('beforeend', ${JSON.stringify(leadersMarkup)});
    const leaders = sheet.querySelector('svg'); if (leaders) Object.assign(leaders.style, {position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'visible'});
  })()` })
  const measured = await page.evaluate(async () => {
    const camera = (window as any).pdfCamera, first = document.querySelector<HTMLButtonElement>('.line-scheme-annotation')!
    const before = first.getBoundingClientRect(), scale = camera.getSnapshot().scale
    const frames: number[] = [], operations: number[] = []
    let previous = performance.now()
    for (let n = 0; n < 60; n++) {
      await new Promise<void>(resolve => requestAnimationFrame(now => { frames.push(now - previous); previous = now; resolve() }))
      const start = performance.now(); camera.zoom(n < 30 ? 1.01 : 1 / 1.01); operations.push(performance.now() - start)
    }
    camera.zoom(1.2)
    const after = first.getBoundingClientRect()
    const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * .95)]
    return { p95Frame: p95(frames.slice(1)), p95Layout: p95(operations), widthRatio: after.width / before.width, scaleRatio: camera.getSnapshot().scale / scale }
  })
  expect(measured.scaleRatio).toBeCloseTo(1.2, 5)
  expect(measured.widthRatio).toBeCloseTo(text ? 1.2 : 1, 2)
  console.log(JSON.stringify({ markerMotion: { text, ...measured } }))
  await info.attach('marker-motion', { body: JSON.stringify(measured), contentType: 'application/json' })
})

test('PDF: Chrome touchpad pinch changes the drawing without zooming the application', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Native CDP pinch is Chrome-specific.')
  await page.setContent(`<style>${css}</style><div class="line-scheme-pdf" style="width:1000px;height:680px"><div class="line-scheme-pdf-stage"><div class="line-scheme-pdf-space"><div class="line-scheme-pdf-sheet"></div></div></div></div>`)
  await page.addScriptTag({ content: `(() => { const exports = {}; ${cameraScript}
    const stage = document.querySelector('.line-scheme-pdf-stage');
    window.pdfCamera = exports.createPdfCamera(stage, document.querySelector('.line-scheme-pdf-space'), document.querySelector('.line-scheme-pdf-sheet'), {width:800,height:1120}, 0, () => {});
    window.pinchEvents = []; stage.addEventListener('wheel', e => window.pinchEvents.push({ctrl:e.ctrlKey, prevented:e.defaultPrevented, delta:e.deltaY}), {passive:true});
  })()` })
  await page.waitForTimeout(40)
  const before = await page.evaluate(() => (window as any).pdfCamera.getSnapshot().scale)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.synthesizePinchGesture', { x: 450, y: 250, scaleFactor: 1.4, relativeSpeed: 400, gestureSourceType: 'mouse' })
  await page.waitForTimeout(50)
  const after = await page.evaluate(() => ({ scale: (window as any).pdfCamera.getSnapshot().scale, browserScale: window.visualViewport!.scale, events: (window as any).pinchEvents }))
  console.log(JSON.stringify({ nativePinch: { ratio: after.scale / before, ...after } }))
  expect(after.scale).toBeGreaterThan(before)
  expect(after.browserScale).toBe(1)
  expect(after.events.length).toBeGreaterThan(1)
  expect(after.events.every((e: { ctrl: boolean; prevented: boolean }) => e.ctrl && e.prevented)).toBeTruthy()
  await page.waitForTimeout(150)
  expect(await page.evaluate(() => (window as any).pdfCamera.getSnapshot().scale)).toBe(after.scale)
  await cdp.detach()
})

test('PDF: continuous trackpad input follows the next frame without an animation tail', async ({ page }) => {
  await page.setContent(`<style>${css}</style><div class="line-scheme-pdf" style="width:1000px;height:680px"><div class="line-scheme-pdf-stage"><div class="line-scheme-pdf-space"><div class="line-scheme-pdf-sheet"></div></div></div></div>`)
  await page.addScriptTag({ content: `(() => { const exports = {}; ${cameraScript}
    window.pdfCamera = exports.createPdfCamera(document.querySelector('.line-scheme-pdf-stage'), document.querySelector('.line-scheme-pdf-space'), document.querySelector('.line-scheme-pdf-sheet'), {width:800,height:1120}, 0, () => {});
  })()` })
  await page.waitForTimeout(40)
  const result = await page.evaluate(async () => {
    const camera = (window as any).pdfCamera, stage = document.querySelector('.line-scheme-pdf-stage')!, start = camera.getSnapshot().scale
    let expected = start
    const lag: number[] = [], nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    for (let frame = 0; frame < 24; frame++) {
      // Multiple precise events arrive between paints, as with a trackpad.
      for (let event = 0; event < 3; event++) {
        stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -1.25, deltaMode: 0, ctrlKey: true, clientX: 450, clientY: 250, cancelable: true }))
        expected *= Math.exp(1.25 * .006)
      }
      await nextFrame()
      lag.push(Math.abs(Math.log(expected / camera.getSnapshot().scale)))
    }
    const end = camera.getSnapshot().scale
    await new Promise(resolve => setTimeout(resolve, 180))
    return { maxLogLag: Math.max(...lag), tailRatio: camera.getSnapshot().scale / end, scaleRatio: camera.getSnapshot().scale / start }
  })
  console.log(JSON.stringify({ trackpadTracking: result }))
  if (process.env.E2E_PDF_CAMERA_BASELINE !== '1') {
    expect(result.maxLogLag).toBeLessThan(.0001)
    expect(result.tailRatio).toBeCloseTo(1, 5)
    expect(result.scaleRatio).toBeCloseTo(Math.exp(90 * .006), 4)
  }
})

test('PDF: ordinary trackpad pan starts promptly and interrupts zoom', async ({ page }) => {
  await page.setContent(`<style>${css}</style><div class="line-scheme-pdf" style="width:1000px;height:680px"><div class="line-scheme-pdf-stage"><div class="line-scheme-pdf-space"><div class="line-scheme-pdf-sheet"></div></div></div></div>`)
  await page.addScriptTag({ content: `(() => { const exports = {}; ${cameraScript}
    window.pdfCamera = exports.createPdfCamera(document.querySelector('.line-scheme-pdf-stage'), document.querySelector('.line-scheme-pdf-space'), document.querySelector('.line-scheme-pdf-sheet'), {width:800,height:1120}, 0, () => {});
  })()` })
  await page.mouse.move(450, 250)
  await page.waitForTimeout(50)
  await page.evaluate(() => {
    const stage = document.querySelector('.line-scheme-pdf-stage') as HTMLElement
    const sheet = document.querySelector('.line-scheme-pdf-sheet')!, start = sheet.getBoundingClientRect()
    const state = { firstWheel: 0, firstMove: 0, scroll: stage.scrollTop, last: stage.scrollTop, backwards: 0, deliveredY: 0, expectedX: start.left, expectedY: start.top, nextFrameLag: [] as number[] }
    ;(window as any).panSample = state
    stage.addEventListener('wheel', event => {
      state.firstWheel ||= performance.now()
      state.deliveredY += event.deltaY
      state.expectedX -= event.deltaX; state.expectedY -= event.deltaY
      requestAnimationFrame(() => {
        const rect = sheet.getBoundingClientRect()
        if (Math.abs(rect.top - start.top) > 1) state.firstMove ||= performance.now()
        state.nextFrameLag.push(Math.hypot(rect.left - state.expectedX, rect.top - state.expectedY))
      })
    }, { passive: true })
    stage.addEventListener('scroll', () => {
      if (stage.scrollTop < state.last - 1) state.backwards++
      state.last = stage.scrollTop
    }, { passive: true })
  })
  for (let n = 0; n < 8; n++) { await page.mouse.wheel(3.25, 7.5); await page.waitForTimeout(8) }
  await page.waitForTimeout(150)
  const pan = await page.evaluate(() => { const p = (window as any).panSample; return { latency: p.firstMove - p.firstWheel, moved: p.last - p.scroll, deliveredY: p.deliveredY, backwards: p.backwards, maxNextFrameLag: Math.max(...p.nextFrameLag) } })
  console.log(JSON.stringify({ trackpadPan: pan }))
  // WebKit's native automation rounds fractional wheel input before delivery;
  // consume exactly the delta the browser delivered, without losing any part.
  expect(pan.deliveredY).toBeGreaterThan(0)
  expect(pan.moved).toBeCloseTo(pan.deliveredY, 0); expect(pan.backwards).toBe(0)
  if (process.env.E2E_PDF_CAMERA_BASELINE !== '1') expect(pan.maxNextFrameLag).toBeLessThan(.75)
  // Switching to a normal two-finger pan must cancel an in-flight zoom.
  const interrupted = await page.evaluate(async () => {
    const stage = document.querySelector('.line-scheme-pdf-stage') as HTMLElement, camera = (window as any).pdfCamera
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -15, ctrlKey: true, clientX: 450, clientY: 250, cancelable: true }))
    await new Promise(resolve => requestAnimationFrame(resolve))
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, clientX: 450, clientY: 250, cancelable: true }))
    const scale = camera.getSnapshot().scale
    await new Promise(resolve => setTimeout(resolve, 160))
    return camera.getSnapshot().scale / scale
  })
  console.log(JSON.stringify({ panInterruptRatio: interrupted }))
  if (process.env.E2E_PDF_CAMERA_BASELINE !== '1') expect(interrupted).toBeCloseTo(1, 5)
  if (process.env.E2E_PDF_CAMERA_BASELINE !== '1') {
    const smallPan = await page.evaluate(async () => {
      const camera = (window as any).pdfCamera, stage = document.querySelector('.line-scheme-pdf-stage') as HTMLElement
      const sheet = document.querySelector('.line-scheme-pdf-sheet')!
      camera.fit('fit-page')
      const start = sheet.getBoundingClientRect(), drift: number[] = []
      for (let n = 1; n <= 12; n++) {
        stage.dispatchEvent(new WheelEvent('wheel', { deltaX: .125, deltaY: .25, cancelable: true }))
        await new Promise(resolve => requestAnimationFrame(resolve))
        const rect = sheet.getBoundingClientRect()
        drift.push(Math.hypot(rect.left - start.left + n * .125, rect.top - start.top + n * .25))
      }
      // Reaching the scroll boundary must not retain an overscroll offset.
      stage.dispatchEvent(new WheelEvent('wheel', { deltaX: -100000, deltaY: -100000, cancelable: true }))
      await new Promise(resolve => requestAnimationFrame(resolve))
      return { drift: Math.max(...drift), left: stage.scrollLeft, top: stage.scrollTop, translation: (sheet as HTMLElement).style.translate }
    })
    expect(smallPan.drift).toBeLessThan(.03)
    expect(smallPan.left).toBe(0); expect(smallPan.top).toBe(0)
    expect(smallPan.translation.split(/\s+/).every(value => parseFloat(value) === 0)).toBeTruthy()
  }
})

for (const rotation of [0, 90]) test(`PDF: wheel anchor and motion, rotation ${rotation}`, async ({ page }) => {
  await page.setContent(`<style>${css}</style><div class="line-scheme-pdf" style="width:1000px;height:680px"><div class="line-scheme-pdf-stage"><div class="line-scheme-pdf-space"><div class="line-scheme-pdf-sheet"></div></div></div></div>`)
  await page.addScriptTag({ content: `(() => { const exports = {}; ${cameraScript}
    const stage = document.querySelector('.line-scheme-pdf-stage'), space = document.querySelector('.line-scheme-pdf-space'), sheet = document.querySelector('.line-scheme-pdf-sheet');
    window.pdfCamera = exports.createPdfCamera(stage, space, sheet, {width:800,height:1120}, ${rotation}, () => {});
  })()` })
  await page.waitForTimeout(40)
  const stage = page.locator('.line-scheme-pdf-stage'), box = await stage.boundingBox()
  const pointer = { x: box!.x + box!.width * .65, y: box!.y + box!.height * .3 }
  await page.evaluate(pointer => {
    const camera = (window as any).pdfCamera, point = camera.toPoint(pointer.x, pointer.y)
    const state = { point, frames: [] as { time: number; scale: number; drift: number }[], stopped: false }
    ;(window as any).motion = state
    const sample = (time: number) => {
      const rect = document.querySelector('.line-scheme-pdf-sheet')!.getBoundingClientRect(), view = camera.getSnapshot()
      const p = view.rotation === 90 ? { x: 1 - point.y, y: point.x } : point
      state.frames.push({ time, scale: view.scale, drift: Math.hypot(rect.left + p.x * rect.width - pointer.x, rect.top + p.y * rect.height - pointer.y) })
      if (!state.stopped) requestAnimationFrame(sample)
    }
    ;(state as any).sample = sample
    requestAnimationFrame(sample)
  }, pointer)
  await page.mouse.move(pointer.x, pointer.y)
  await page.keyboard.down('Control')
  for (let n = 0; n < 12; n++) { await page.mouse.wheel(0, -8); await page.waitForTimeout(40) }
  await page.keyboard.up('Control')
  await page.waitForTimeout(200)
  const motion = await page.evaluate(() => {
    const state = (window as any).motion; state.stopped = true
    const frames = state.frames as { time: number; scale: number; drift: number }[]
    const intervals = frames.slice(1).map((f, i) => f.time - frames[i].time).sort((a, b) => a - b)
    return { maxDrift: Math.max(...frames.map(f => f.drift)), changingFrames: frames.filter((f, i) => i && f.scale > frames[i - 1].scale + .00001).length,
      scaleRatio: frames.at(-1)!.scale / frames[0].scale, maxFrameMs: intervals.at(-1), p95Ms: intervals[Math.floor(intervals.length * .95)], backwards: frames.filter((f, i) => i && f.scale < frames[i - 1].scale - .00001).length }
  })
  console.log(JSON.stringify({ cameraMotion: { rotation, ...motion } }))
  if (process.env.E2E_PDF_CAMERA_BASELINE !== '1') {
    expect(motion.maxDrift).toBeLessThan(.75)
    // Pixel input supplies intermediate steps itself; no synthetic tail.
    expect(motion.changingFrames).toBeGreaterThanOrEqual(12)
    expect(motion.backwards).toBe(0)
    expect(motion.scaleRatio).toBeCloseTo(Math.exp(96 * .006), 2)
    // Reversing through the fit boundary must keep the same anchor, too.
    await page.waitForTimeout(40)
    await page.evaluate(() => { const state = (window as any).motion; state.frames = []; state.stopped = false; requestAnimationFrame(state.sample) })
    await page.keyboard.down('Control')
    for (let n = 0; n < 12; n++) { await page.mouse.wheel(0, 8); await page.waitForTimeout(40) }
    await page.keyboard.up('Control'); await page.waitForTimeout(200)
    const reverse = await page.evaluate(() => {
      const state = (window as any).motion; state.stopped = true
      return { maxDrift: Math.max(...state.frames.map((f: { drift: number }) => f.drift)), ratio: state.frames.at(-1).scale / state.frames[0].scale }
    })
    expect(reverse.maxDrift).toBeLessThan(.75)
    expect(reverse.ratio).toBeCloseTo(Math.exp(-96 * .006), 2)
    // A toolbar command during motion cancels the tail of the wheel gesture.
    await page.evaluate(() => (window as any).pdfCamera.fit('fit-page'))
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control')
    await page.waitForFunction(() => (window as any).pdfCamera.getSnapshot().mode === 'custom')
    const fitted = await page.evaluate(() => { const camera = (window as any).pdfCamera; camera.fit('fit-page'); return camera.getSnapshot() })
    await page.waitForTimeout(180)
    expect(await page.evaluate(() => (window as any).pdfCamera.getSnapshot())).toEqual(fitted)
  }
})
