import { filterSchemeProject } from '../line-scheme-grid'
import { expect, test } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { withE2eDatabase } from '../database'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'

const trackProject = schemeFixtureCleanup(test)

test('PDF: большой скан, векторный A0, 1000 точек на листе, повторное открытие и освобождение worker', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'Подробное измерение плотной схемы выполняется в основном браузере Chrome.')
  test.setTimeout(180_000)
  page.setDefaultTimeout(20_000)
  const project = 'E2E dense PDF', line = 'DENSE-01'
  trackProject(testInfo, project)
  let lineId = 0
  await withE2eDatabase(async db => {
    lineId = (await db.query("insert into line_programs(project_title,subtitle_code,line,psto_assignment) values ($1,'DENSE',$2,'unassigned') returning id", [project, line])).rows[0].id
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,connection_type,weld_date,has_vik,psto_required)
      select $1,$2,'DENSE',$3,'D'||n,'действующий','актуальная','С',date '2026-11-01','Да','Нет' from generate_series(1,2000) n`, [lineId, project, line])
    await db.query("insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where line_program_id=$1", [lineId])
  })
  await page.goto('/line-schemes')
  // A deterministic noisy scan stresses decoded image memory and transfer size.
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 3000; canvas.height = 2000
    const context = canvas.getContext('2d')!, data = context.createImageData(canvas.width, canvas.height)
    let seed = 17
    for (let i = 0; i < data.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0
      const shade = 150 + ((seed >>> 24) % 106)
      data.data[i] = shade; data.data[i + 1] = shade; data.data[i + 2] = shade; data.data[i + 3] = 255
    }
    context.putImageData(data, 0, 0); context.font = 'bold 100px sans-serif'; context.fillStyle = '#123456'; context.fillText('SCANNED DRAWING', 200, 1000)
    return canvas.toDataURL('image/jpeg', .95).split(',')[1]
  })
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), scan = await pdf.embedJpg(Buffer.from(jpeg, 'base64'))
  for (let sheet = 0; sheet < 4; sheet++) {
    const drawing = pdf.addPage([3370, 2384])
    if (sheet % 2) drawing.drawImage(scan, { x: 0, y: 0, width: 3370, height: 2384 })
    else {
      drawing.drawText(`A0 drawing ${sheet + 1}`, { x: 100, y: 2200, size: 55, font })
      for (let n = 0; n < 20_000; n++) drawing.drawLine({ start: { x: (n * 71) % 3370, y: (n * 37) % 2200 }, end: { x: (n * 71) % 3370 + 12, y: (n * 37) % 2200 + 5 }, thickness: .5, color: rgb(.2, .3, .4) })
    }
  }
  const buffer = Buffer.from(await pdf.save())
  await filterSchemeProject(page, project)
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true })
  const chooser = await chooserPromise
  const uploadStart = Date.now()
  await chooser.setFiles({ name: 'Dense A0.pdf', mimeType: 'application/pdf', buffer })
  await page.getByRole('dialog', { name: /^Файлы и архив линии/ }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  await expect(dialog.locator('[data-scheme-point-layer="1"]')).toBeVisible({ timeout: 40_000 })
  const uploadAndOpenMs = Date.now() - uploadStart
  await dialog.getByRole('button', { name: 'Закрыть схему' }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  await withE2eDatabase(async db => {
    const revision = (await db.query('select active_revision_id from line_scheme_bundles where line_program_id=$1', [lineId])).rows[0].active_revision_id
    await db.query('insert into line_scheme_physicals(seed_node_id,last_label,last_line_program_id) select id,joint,$1 from weld_joints where line_program_id=$1', [lineId])
    await db.query('insert into line_scheme_members(weld_joint_id,physical_id) select seed_node_id,id from line_scheme_physicals where last_line_program_id=$1', [lineId])
    await db.query(`insert into line_scheme_points(id,revision_id,physical_id,page,x,y)
      select md5($1||id::text)::uuid::text,$1,id,1+(rn/1000)::integer,((rn%40)+0.5)/40.0,(((rn%1000)/40)+0.5)/25.0
      from (select id,(row_number() over(order by id)-1)::integer rn from line_scheme_physicals where last_line_program_id=$2) points`, [revision, lineId])
    if (process.env.E2E_SCHEME_DIMENSIONS === '1') await db.query(`insert into line_scheme_dimensions(id,revision_id,from_point_id,to_point_id,page,distance_mm,offset_x,offset_y)
      select md5('size'||id)::uuid::text,$1,least(id,next),greatest(id,next),page,1000,0,-0.01 from
      (select id,page,lead(id) over(partition by page order by physical_id) next,row_number() over(partition by page order by physical_id) rn from line_scheme_points where revision_id=$1) p
      where rn%2=1 and next is not null`, [revision])
    if (process.env.E2E_SCHEME_ANNOTATIONS === '1') {
      await db.query(`insert into line_scheme_annotations(id,revision_id,page,x,y,shape,label,color,size,stroke_width,rotation)
        select md5('annotation'||$1||n::text)::uuid::text,$1,1,((n%30)+0.7)/30.0,((n/30)+0.7)/11.0,
        case n%3 when 0 then 'triangle' when 1 then 'line' else 'dot' end,'Support '||n,'#0284c7',24,2,45 from generate_series(0,299) n`, [revision])
      await db.query(`insert into line_scheme_dimensions(id,revision_id,from_annotation_id,to_point_id,page,distance_mm,offset_x,offset_y)
        select md5('mixed'||a.id)::uuid::text,$1,a.id,p.id,1,750,0,0.01 from
        (select id,row_number() over(order by id) rn from line_scheme_annotations where revision_id=$1) a
        join (select id,row_number() over(order by id) rn from line_scheme_points where revision_id=$1 and page=1) p using(rn) where a.rn<=150`, [revision])
    }
    if (process.env.E2E_SCHEME_STYLES === '1') {
      await db.query(`update line_scheme_dimensions d set color=(array['#64748b','#111827','#dc2626','#2563eb','#16a34a','#ea580c','#6b7280'])[(n.rn%7+1)::integer],
        stroke_width=(array[1,1.5,2,3])[(n.rn/7%4+1)::integer]
        from (select id,row_number() over(order by id) rn from line_scheme_dimensions where revision_id=$1) n where n.id=d.id`, [revision])
      await db.query("update line_scheme_annotations set note='Крепление опоры: проверить после монтажа' where revision_id=$1", [revision])
    }
  })
  const extraAnnotations = process.env.E2E_SCHEME_ANNOTATIONS === '1' ? 300 : 0
  const dimensionCount = (process.env.E2E_SCHEME_DIMENSIONS === '1' ? 500 : 0) + (extraAnnotations ? 150 : 0)
  const diagnostics = await page.context().newCDPSession(page)
  let maxContentLayers = 0
  diagnostics.on('LayerTree.layerTreeDidChange', ({ layers }) => { maxContentLayers = Math.max(maxContentLayers, layers?.filter(layer => layer.drawsContent).length ?? 0) })
  await diagnostics.send('LayerTree.enable')
  await diagnostics.send('Network.enable')
  await diagnostics.send('Network.setCacheDisabled', { cacheDisabled: true })
  await page.reload()
  await filterSchemeProject(page, project)
  const opens: number[] = [], errors: string[] = [], requests: string[] = []
  const profiles: Array<{ readyMs: number; marks: unknown[]; requests: unknown[] }> = []
  let originalPreview: { width: number; height: number; hash: string } | undefined
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  for (let cycle = 0; cycle < (process.env.E2E_PDF_PROFILE === '1' ? 9 : 3); cycle++) {
    await page.evaluate(() => {
      const state = { clicked: 0, painted: 0 }
      ;(window as any).__schemeOpen = state
      document.addEventListener('click', () => { state.clicked = performance.now() }, { capture: true, once: true })
      const observer = new MutationObserver(() => {
        if (!document.querySelector('canvas[data-pdf-rendered="preview"]') || document.querySelectorAll('[data-scheme-point]').length !== 1000) return
        observer.disconnect()
        requestAnimationFrame(() => requestAnimationFrame(() => { state.painted = performance.now() }))
      })
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-pdf-rendered'] })
    })
    const start = Date.now()
    await page.getByRole('row').filter({ hasText: project }).locator('[col-id="pdf"] button').click()
    await expect(dialog.locator('[data-scheme-point]')).toHaveCount(1000, { timeout: 30_000 })
    await expect.poll(() => dialog.locator('.line-scheme-pdf-stage canvas[data-pdf-rendered="preview"]').evaluateAll(items => items.some(image => (image as HTMLCanvasElement).width > 0))).toBeTruthy()
    opens.push(Date.now() - start)
    await page.waitForFunction(() => (window as any).__schemeOpen.painted > 0)
    profiles.push(await page.evaluate(() => {
      const state = (window as any).__schemeOpen, since = state.clicked
      return { readyMs: Math.round(state.painted - since), marks: performance.getEntriesByType('mark').filter(e => e.name.startsWith('scheme-pdf:')).map(e => [e.name.replace('scheme-pdf:', ''), Math.round(e.startTime - since)]),
        requests: (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter(e => e.startTime >= since && (/line-scheme-file|pdf\.worker|pdf\.renderer|_serverFn/.test(e.name))).map(e => ({ kind: /line-scheme-file/.test(e.name) ? 'file' : /_serverFn/.test(e.name) ? 'rpc' : 'worker', start: Math.round(e.startTime - since), ms: e.duration >= 0 ? Math.round(e.duration) : null, bytes: e.transferSize })) }
    }))
    const previewPixels = await dialog.locator('canvas[data-pdf-rendered="preview"]').evaluate(async (canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      const digest = await crypto.subtle.digest('SHA-256', pixels)
      return { width: canvas.width, height: canvas.height, hash: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') }
    })
    if (originalPreview) expect(previewPixels).toEqual(originalPreview); else originalPreview = previewPixels
    await dialog.getByLabel('Лист PDF', { exact: true }).selectOption('2')
    await expect(dialog.locator('[data-scheme-point-layer="2"]')).toBeVisible()
    await expect(dialog.locator('[data-scheme-point]')).toHaveCount(1000)
    // A partial response is useful independently of the viewer's full-file fetch.
    if (!cycle) {
      const revision = await dialog.getByLabel('Редакция PDF').inputValue()
      const response = await page.request.get(`/api/line-scheme-file?revision=${revision}`, { headers: { Range: 'bytes=0-15' } })
      expect(response.status()).toBe(206); expect((await response.body()).length).toBe(16)
      expect(response.headers()['content-range']).toBe(`bytes 0-15/${buffer.length}`)
    }
    await dialog.getByRole('button', { name: 'Закрыть схему' }).click()
    await expect.poll(() => page.workers().length).toBe(0)
    if (!cycle) await diagnostics.send('Network.setCacheDisabled', { cacheDisabled: false })
  }
  await page.getByRole('row').filter({ hasText: project }).locator('[col-id="pdf"] button').click()
  await expect(dialog.locator('[data-scheme-point]')).toHaveCount(1000)
  await expect(dialog.locator('[data-scheme-dimension]')).toHaveCount(dimensionCount)
  if (dimensionCount) await expect(dialog.locator('[data-dimension-style]')).toHaveCount(process.env.E2E_SCHEME_STYLES === '1' ? 28 : 1)
  let dimensionSaveMs: number | undefined
  if (process.env.E2E_SCHEME_DIMENSIONS === '1') {
    // At whole-sheet scale 1500 fixed-size labels overlap. Zoom as an operator
    // would before choosing one; restore the same fit for frame measurements.
    for (let step = 0; step < 5; step++) await dialog.getByRole('button', { name: 'Увеличить PDF' }).click()
    if (extraAnnotations) {
      // A support label can cover a randomly seeded dimension. Use the normal
      // sidebar entry point instead of bypassing pointer hit testing.
      await dialog.getByRole('tab', { name: /^Размеры/ }).click()
      await dialog.getByRole('button', { name: /^Размер / }).first().click()
    } else await dialog.locator('[data-scheme-dimension]').first().click()
    const edit = dialog.getByRole('form', { name: 'Расстояние между точками', exact: true })
    await edit.getByLabel('Расстояние, мм', { exact: true }).fill('1001')
    await edit.getByRole('button', { name: 'Применить размер' }).click()
    const start = Date.now()
    await dialog.getByRole('button', { name: /^Сохранить/ }).click()
    await expect(dialog.getByRole('button', { name: /^Сохранить/ })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Обновить состояния' })).toBeEnabled()
    dimensionSaveMs = Date.now() - start
    await expect(dialog.locator('[data-scheme-dimension]')).toHaveCount(dimensionCount)
    await dialog.getByRole('button', { name: 'Весь лист', exact: true }).click()
  }
  await page.evaluate(() => {
    const state = { frames: [] as number[], last: performance.now(), stopped: false }
    ;(window as any).__schemeFrames = state
    const sample = (now: number) => { state.frames.push(now - state.last); state.last = now; if (!state.stopped) requestAnimationFrame(sample) }
    requestAnimationFrame(sample)
  })
  for (let step = 0; step < 5; step++) await dialog.getByRole('button', { name: 'Увеличить PDF' }).click()
  const stage = await dialog.locator('.line-scheme-pdf-stage').boundingBox()
  await page.mouse.move(stage!.x + stage!.width - 20, stage!.y + stage!.height - 20)
  await page.mouse.down(); await page.mouse.move(stage!.x + stage!.width - 200, stage!.y + stage!.height - 150, { steps: 30 }); await page.mouse.up()
  await dialog.getByRole('button', { name: 'Весь лист', exact: true }).click()
  const frames = await page.evaluate(async () => {
    await new Promise<void>(resolve => { let count = 0; const next = () => ++count === 30 ? resolve() : requestAnimationFrame(next); requestAnimationFrame(next) })
    const state = (window as any).__schemeFrames; state.stopped = true
    const sorted = [...state.frames].sort((a: number, b: number) => a - b)
    return { samples: sorted.length, p95Ms: Math.round(sorted[Math.floor(sorted.length * .95)]), maxMs: Math.round(sorted.at(-1)), over50Ms: sorted.filter((value: number) => value > 50).length }
  })
  await expect(dialog.locator('[data-pdf-current-page]')).toHaveAttribute('data-pdf-current-page', '1')
  await page.screenshot({ path: testInfo.outputPath('dense-scheme.png') })
  const zoomProfiles: unknown[] = []
  if (process.env.E2E_PDF_PROFILE === '1') {
    for (let zoom = 0; zoom < 6; zoom++) {
      await page.evaluate(() => {
        performance.clearMarks('scheme-pdf:detail-start'); performance.clearMarks('scheme-pdf:detail-ready'); performance.clearMarks('scheme-pdf:zoom')
        document.addEventListener('click', () => performance.mark('scheme-pdf:zoom'), { capture: true, once: true })
      })
      await dialog.getByRole('button', { name: 'Увеличить PDF' }).click()
      await page.waitForFunction(() => performance.getEntriesByName('scheme-pdf:detail-ready').length > 0)
      zoomProfiles.push(await page.evaluate(() => {
        const since = performance.getEntriesByName('scheme-pdf:zoom').at(-1)!.startTime
        return performance.getEntriesByType('mark').filter(e => /scheme-pdf:detail-/.test(e.name)).map(e => [e.name, Math.round(e.startTime - since)])
      }))
    }
    await page.screenshot({ path: testInfo.outputPath('dense-profile-zoom.png') })
    await dialog.getByRole('button', { name: 'Весь лист', exact: true }).click()
  }
  expect(page.workers().some(worker => /pdf\.worker/.test(worker.url()))).toBeTruthy()
  expect(page.workers().some(worker => /pdf\.renderer/.test(worker.url()))).toBeTruthy()
  // Enlarging an A0 sheet refines only the visible region, within the canvas
  // budget; point placement and the background-opacity layer stay separate.
  for (let step = 0; step < 10; step++) await dialog.getByRole('button', { name: 'Увеличить PDF' }).click()
  const detail = dialog.locator('canvas[data-pdf-rendered="detail"]')
  await expect(detail).toHaveCount(1)
  await expect.poll(() => detail.evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.getBoundingClientRect().width)).toBeGreaterThanOrEqual(.999)
  const surface = await detail.evaluate((canvas: HTMLCanvasElement) => ({ pixels: canvas.width * canvas.height, width: canvas.width, height: canvas.height }))
  expect(surface.pixels).toBeLessThan(12_020_000)
  expect(Math.max(surface.width, surface.height)).toBeLessThanOrEqual(8192)
  await page.screenshot({ path: testInfo.outputPath('dense-scheme-zoom.png') })
  // A small pan stays inside the sharp overscan area and must not repaint it.
  await detail.evaluate(canvas => { canvas.dataset.panProbe = 'same' })
  await dialog.locator('.line-scheme-pdf-stage').evaluate(element => { element.scrollLeft += 30 })
  await page.waitForTimeout(180)
  await expect(detail).toHaveAttribute('data-pan-probe', 'same')
  // Wheel zoom is stronger, still anchored to the pointer instead of the
  // viewport centre. The same physical sheet coordinate remains under it.
  const area = await dialog.locator('.line-scheme-pdf-stage').boundingBox()
  const pointer = { x: area!.x + area!.width * .63, y: area!.y + area!.height * .4 }
  const sheet = dialog.locator('.line-scheme-pdf-sheet'), old = await sheet.boundingBox()
  const anchor = { x: (pointer.x - old!.x) / old!.width, y: (pointer.y - old!.y) / old!.height }
  if (process.env.E2E_SCHEME_TRACE === '1') await diagnostics.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' })
  await page.evaluate(({ pointer, anchor }) => {
    const state = { frames: [] as { time: number; drift: number }[], stopped: false }
    ;(window as any).__wheelMotion = state
    const sample = (time: number) => {
      const box = document.querySelector('.line-scheme-pdf-sheet')!.getBoundingClientRect()
      state.frames.push({ time, drift: Math.hypot(box.x + anchor.x * box.width - pointer.x, box.y + anchor.y * box.height - pointer.y) })
      if (!state.stopped) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, { pointer, anchor })
  await page.mouse.move(pointer.x, pointer.y)
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control')
  await expect.poll(async () => (await sheet.boundingBox())!.width / old!.width).toBeCloseTo(Math.exp(.6), 2)
  const next = await sheet.boundingBox()
  expect((pointer.x - next!.x) / next!.width).toBeCloseTo(anchor.x, 3)
  expect((pointer.y - next!.y) / next!.height).toBeCloseTo(anchor.y, 3)
  await page.keyboard.down('Control')
  for (let n = 0; n < 6; n++) { await page.mouse.wheel(0, -8); await page.waitForTimeout(40) }
  await page.keyboard.up('Control')
  await expect.poll(async () => (await sheet.boundingBox())!.width / old!.width).toBeCloseTo(Math.exp(.6 + 48 * .006), 2)
  const wheelFrames = await page.evaluate(() => {
    const state = (window as any).__wheelMotion; state.stopped = true
    const samples = state.frames as { time: number; drift: number }[]
    const intervals = samples.slice(1).map((f, i) => f.time - samples[i].time).sort((a, b) => a - b)
    return { maxDriftPx: Math.max(...samples.map(f => f.drift)), maxMs: Math.round(intervals.at(-1)!), p95Ms: Math.round(intervals[Math.floor(intervals.length * .95)]), over50Ms: intervals.filter(ms => ms > 50).length }
  })
  expect(wheelFrames.maxDriftPx).toBeLessThan(.75)
  if (process.env.E2E_SCHEME_TRACE === '1') {
    const complete = new Promise<{ stream?: string }>(resolve => diagnostics.once('Tracing.tracingComplete', resolve))
    await diagnostics.send('Tracing.end')
    const { stream } = await complete
    if (!stream) throw new Error('Chrome did not return the requested trace stream')
    let content = ''
    for (;;) { const chunk = await diagnostics.send('IO.read', { handle: stream }); content += chunk.data; if (chunk.eof) break }
    await diagnostics.send('IO.close', { handle: stream })
    await testInfo.attach('zoom-trace', { body: content, contentType: 'application/json' })
    const grouped = new Map<string, { count: number; totalMs: number; maxMs: number }>()
    for (const event of JSON.parse(content).traceEvents) if (event.ph === 'X' && event.dur && /^(UpdateLayoutTree|Layout|PrePaint|Paint|Layerize|FunctionCall|FireAnimationFrame|EventDispatch)$/.test(event.name)) {
      const row = grouped.get(event.name) ?? { count: 0, totalMs: 0, maxMs: 0 }; row.count++; row.totalMs += event.dur / 1000; row.maxMs = Math.max(row.maxMs, event.dur / 1000); grouped.set(event.name, row)
    }
    console.log(JSON.stringify({ zoomTrace: Object.fromEntries(grouped) }))
  }
  await dialog.getByRole('button', { name: 'Весь лист', exact: true }).click()
  for (let n = 0; n < 3; n++) await dialog.getByRole('button', { name: 'Увеличить PDF' }).click()
  await page.waitForTimeout(200)
  await page.mouse.move(pointer.x, pointer.y)
  await page.evaluate(() => {
    const stage = document.querySelector('.line-scheme-pdf-stage') as HTMLElement
    const state = { firstWheel: 0, firstMove: 0, startX: stage.scrollLeft, startY: stage.scrollTop, lastY: stage.scrollTop, backwards: 0, frames: [] as number[], last: performance.now(), stopped: false }
    ;(window as any).__trackpadPan = state
    const wheel = () => { state.firstWheel ||= performance.now() }
    stage.addEventListener('wheel', wheel, { passive: true, once: true })
    const sample = (now: number) => {
      if (Math.abs(stage.scrollTop - state.startY) > 1) state.firstMove ||= now
      if (stage.scrollTop < state.lastY - 1) state.backwards++
      state.lastY = stage.scrollTop; state.frames.push(now - state.last); state.last = now
      if (!state.stopped) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  // Pixel deltas, diagonal motion and momentum-style small repeated events.
  for (let n = 0; n < 24; n++) { await page.mouse.wheel(2.5, 6.25); await page.waitForTimeout(8) }
  await page.waitForTimeout(150)
  const trackpadPan = await page.evaluate(() => {
    const state = (window as any).__trackpadPan; state.stopped = true
    const stage = document.querySelector('.line-scheme-pdf-stage') as HTMLElement, frames = state.frames.sort((a: number, b: number) => a - b)
    return { latencyMs: state.firstMove - state.firstWheel, movedX: stage.scrollLeft - state.startX, movedY: stage.scrollTop - state.startY, backwards: state.backwards,
      p95Ms: frames[Math.floor(frames.length * .95)], maxMs: frames.at(-1), over50Ms: frames.filter((n: number) => n > 50).length }
  })
  console.log(JSON.stringify({ denseTrackpadPan: trackpadPan }))
  expect(trackpadPan.movedX).toBeCloseTo(60, 0); expect(trackpadPan.movedY).toBeCloseTo(150, 0); expect(trackpadPan.backwards).toBe(0)
  await dialog.getByRole('button', { name: 'Закрыть схему' }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  // A preview from a 1× screen must not be stretched on a 2× display.
  await diagnostics.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
  await page.getByRole('row').filter({ hasText: project }).locator('[col-id="pdf"] button').click()
  await expect(dialog.locator('[data-scheme-point]')).toHaveCount(1000)
  const retinaPreview = dialog.locator('canvas[data-pdf-rendered="preview"]')
  await expect.poll(() => retinaPreview.evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.getBoundingClientRect().width)).toBeGreaterThanOrEqual(1.999)
  await dialog.getByRole('button', { name: 'Закрыть схему' }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  expect(errors).toEqual([])
  expect(requests.filter(url => /^https?:/.test(url) && !url.startsWith('http://127.0.0.1:'))).toEqual([])
  await diagnostics.detach()
  console.log(JSON.stringify({ denseScheme: { pdfBytes: buffer.length, sheets: 4, points: 2000, pointsOnVisiblePage: 1000, dimensionsOnVisiblePage: dimensionCount, annotationsOnVisiblePage: extraAnnotations, styled: process.env.E2E_SCHEME_STYLES === '1', dimensionSaveMs, maxContentLayers, uploadAndOpenMs, coldCacheOpenMs: profiles[0].readyMs, repeatOpenMs: profiles.slice(1).map(profile => profile.readyMs), frameIntervals: frames, wheelFrames, remainingWorkers: page.workers().length }, driverWaitMs: opens, profiles, zoomProfiles }))
})
