import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFile, rm } from 'node:fs/promises'
import { withE2eDatabase } from '../database'
import { filterSchemeProject } from '../line-scheme-grid'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'

const trackProject = schemeFixtureCleanup(test)

// Measure browser events → painted state, independently of Playwright polling.
async function startPaintProbe(page: Page, kind: 'open' | 'save') {
  await page.evaluate(kind => {
    const state = { start: 0, end: 0, confirmed: 0 }
    ;(window as any).__largePdfPaint = state
    document.addEventListener('click', () => { state.start = performance.now() }, { capture: true, once: true })
    const observer = new MutationObserver(() => {
      const ready = kind === 'open'
        ? document.querySelector('canvas[data-pdf-rendered="preview"]') && document.querySelectorAll('[data-scheme-point]').length === 500
        : [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Сохранить' && button.disabled)
      if (!state.start || !ready) return
      if (kind === 'save') {
        state.confirmed ||= performance.now()
        // The post-save state refresh temporarily prevents editing too. Include
        // that wait in usability latency, separately from the commit feedback.
        if (document.querySelector<HTMLButtonElement>('button[aria-label="Обновить состояния"]')?.disabled) return
      }
      observer.disconnect()
      requestAnimationFrame(() => requestAnimationFrame(() => { state.end = performance.now() }))
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  }, kind)
}
async function readPaintProbe(page: Page) {
  await page.waitForFunction(() => (window as any).__largePdfPaint.end > 0)
  return page.evaluate(() => Math.round((window as any).__largePdfPaint.end - (window as any).__largePdfPaint.start))
}

test('PDF near byte/page limits: partial reads, cold/warm opens, zoom, batch save and reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'Большой файл и подробные сетевые замеры проверяются в Chrome.')
  test.setTimeout(300_000)
  const project = 'E2E near-limit PDF', line = 'LARGE-100'
  trackProject(testInfo, project)
  const lineId = await withE2eDatabase(async db => {
    const id = (await db.query("insert into line_programs(project_title,subtitle_code,line,psto_assignment) values ($1,'LARGE',$2,'unassigned') returning id", [project, line])).rows[0].id
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,connection_type,weld_date,has_vik,psto_required)
      select $1,$2,'LARGE',$3,'L'||n,'действующий','актуальная','С',date '2026-11-01','Да','Нет' from generate_series(1,1000) n`, [id, project, line])
    await db.query("insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where line_program_id=$1", [id])
    return id
  })
  await page.goto('/line-schemes')
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), scans = []
  let imageBytes = 0
  // Real, distinct JPEG streams; no artificial padding or giant unused objects.
  while (imageBytes < 85 * 1024 * 1024) {
    const jpeg: string = await page.evaluate(seed => {
      const canvas = document.createElement('canvas'); canvas.width = 3000; canvas.height = 2400
      const context = canvas.getContext('2d')!, pixels = context.createImageData(canvas.width, canvas.height)
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0
        pixels.data[i] = seed >>> 24; pixels.data[i + 1] = (seed >>> 16) & 255; pixels.data[i + 2] = (seed >>> 8) & 255; pixels.data[i + 3] = 255
      }
      context.putImageData(pixels, 0, 0)
      return canvas.toDataURL('image/jpeg', .92).split(',')[1]
    }, 17 + scans.length)
    const bytes: Buffer = Buffer.from(jpeg, 'base64'); imageBytes += bytes.length
    scans.push(await pdf.embedJpg(bytes))
  }
  for (let n = 0; n < 100; n++) {
    const sheet = pdf.addPage([3370, 2384])
    sheet.drawImage(scans[n % scans.length], { x: 0, y: 0, width: 3370, height: 2384 })
    sheet.drawText(`A0 scan ${n + 1}`, { x: 100, y: 2200, size: 70, font })
  }
  const buffer = Buffer.from(await pdf.save())
  expect(buffer.length).toBeGreaterThan(85 * 1024 * 1024)
  expect(buffer.length).toBeLessThan(100 * 1024 * 1024)
  const sourceFile = testInfo.outputPath('Large 100 sheets.pdf')
  await writeFile(sourceFile, buffer)
  await filterSchemeProject(page, project)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  await (await chooser).setFiles(sourceFile)
  const uploaded = Date.now()
  await page.getByRole('dialog', { name: /^Файлы и архив линии/ }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true })
  // S3 publication is part of the server's existing 120-second upload deadline.
  // Do not cancel a valid near-limit upload at 60 seconds on a slower uplink.
  await expect(dialog.locator('canvas[data-pdf-rendered="preview"]')).toBeVisible({ timeout: process.env.LINE_SCHEME_STORAGE_DRIVER === 's3' ? 150_000 : 60_000 })
  const uploadAndOpenMs = Date.now() - uploaded
  await rm(sourceFile)
  await dialog.getByRole('button', { name: 'Закрыть схему' }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  const revisionId = await withE2eDatabase(async db => {
    const revision = (await db.query('select active_revision_id from line_scheme_bundles where line_program_id=$1', [lineId])).rows[0].active_revision_id
    await db.query('insert into line_scheme_physicals(seed_node_id,last_label,last_line_program_id) select id,joint,$1 from weld_joints where line_program_id=$1', [lineId])
    await db.query('insert into line_scheme_members(weld_joint_id,physical_id) select seed_node_id,id from line_scheme_physicals where last_line_program_id=$1', [lineId])
    await db.query(`insert into line_scheme_points(id,revision_id,physical_id,page,x,y)
      select md5($1||id::text)::uuid::text,$1,id,case when rn<500 then 1 else 100 end,((rn%25)+0.5)/25.0,(((rn%500)/25)+0.5)/20.0
      from (select id,(row_number() over(order by id)-1)::integer rn from line_scheme_physicals where last_line_program_id=$2) points`, [revision, lineId])
    return revision
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  const fileRequests = new Set<string>(); let transferred = 0
  cdp.on('Network.requestWillBeSent', event => { if (event.request.url.includes('/api/line-scheme-file?')) fileRequests.add(event.requestId) })
  cdp.on('Network.dataReceived', event => { if (fileRequests.has(event.requestId)) transferred += event.dataLength })
  const errors: string[] = [], writes: { bytes: number; body: string }[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.method() === 'POST') { const body = request.postData() ?? ''; writes.push({ bytes: Buffer.byteLength(body), body }) } })
  await page.reload(); await filterSchemeProject(page, project)
  const open = async () => {
    await startPaintProbe(page, 'open')
    await page.getByRole('row').filter({ hasText: project }).locator('[col-id="pdf"] button').click()
    return readPaintProbe(page)
  }
  const opens = [], fileBytes = []
  for (let cycle = 0; cycle < 3; cycle++) {
    transferred = 0; opens.push(await open()); fileBytes.push(transferred)
    await dialog.getByRole('button', { name: 'Закрыть схему' }).click()
    await expect.poll(() => page.workers().length).toBe(0)
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  }
  // A cold first page over a modest connection must not wait for all 90 MB.
  await page.reload(); await filterSchemeProject(page, project)
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 25_000_000 / 8, uploadThroughput: 10_000_000 / 8 })
  transferred = 0
  const networkOpenMs = await open(), networkOpenBytes = transferred
  expect(networkOpenBytes).toBeLessThan(buffer.length * .3)
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  const lastPageStart = Date.now()
  await dialog.getByLabel('Лист PDF', { exact: true }).selectOption('100')
  await expect(dialog.locator('[data-scheme-point-layer="100"]')).toBeVisible()
  await expect(dialog.locator('[data-scheme-point]')).toHaveCount(500)
  await expect(dialog.locator('canvas[data-pdf-rendered="preview"]')).toBeVisible()
  const lastPageMs = Date.now() - lastPageStart
  await dialog.getByLabel('Лист PDF', { exact: true }).selectOption('1')
  await expect(dialog.locator('[data-scheme-point-layer="1"]')).toBeVisible()
  await expect(dialog.locator('[data-scheme-point]')).toHaveCount(500)
  const stage = (await dialog.locator('.line-scheme-pdf-stage').boundingBox())!
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2)
  const postsBeforeZoom = writes.length
  await page.evaluate(() => {
    const probe = { frames: [] as number[], last: performance.now(), stop: false }; (window as any).__largePdfFrames = probe
    const sample = (now: number) => { probe.frames.push(now - probe.last); probe.last = now; if (!probe.stop) requestAnimationFrame(sample) }; requestAnimationFrame(sample)
  })
  await page.keyboard.down('Control')
  for (let n = 0; n < 16; n++) await page.mouse.wheel(0, -12)
  await page.keyboard.up('Control')
  const detail = dialog.locator('canvas[data-pdf-rendered="detail"]')
  await expect(detail).toBeVisible()
  await expect.poll(() => detail.evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.getBoundingClientRect().width)).toBeGreaterThanOrEqual(.999)
  const frames = await page.evaluate(() => {
    const p = (window as any).__largePdfFrames; p.stop = true; const frames = p.frames.sort((a: number, b: number) => a - b)
    return { p95Ms: frames[Math.floor(frames.length * .95)], maxMs: frames.at(-1), over50Ms: frames.filter((v: number) => v > 50).length }
  })
  expect(writes.length).toBe(postsBeforeZoom)
  expect(await detail.evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height)).toBeLessThan(12_020_000)
  await dialog.getByRole('button', { name: 'Весь лист', exact: true }).click()
  const before = await withE2eDatabase(async db => (await db.query('select id,x,y,page from line_scheme_points where revision_id=$1 order by id', [revisionId])).rows)
  const saved: { changes: number; ms: number; confirmedMs: number; bytes: number; requests: number }[] = []
  for (const count of [1, 25]) {
    // Exercise actual pointer capture/React draft handling, not an injected API save.
    for (let n = 0; n < count; n++) {
      // Choose the short top-row labels; dense four-character labels overlap
      // adjacent circles at fit-page zoom and intentionally open their tooltip.
      const marker = dialog.locator(`[data-scheme-point][aria-label="Стык L${n + 1}"]`), box = (await marker.boundingBox())!
      await page.mouse.move(box.x + 8, box.y + 8); await page.mouse.down()
      await page.mouse.move(box.x - 2, box.y + 18, { steps: 2 }); await page.mouse.up()
      await expect(dialog.getByRole('button', { name: `Сохранить (${n + 1})`, exact: true })).toBeEnabled()
    }
    await expect(dialog.getByRole('button', { name: `Сохранить (${count})`, exact: true })).toBeEnabled()
    const requestStart = writes.length, fileStart = fileRequests.size
    await startPaintProbe(page, 'save')
    await dialog.getByRole('button', { name: /^Сохранить/ }).click()
    const ms = await readPaintProbe(page), saveWrites = writes.slice(requestStart).filter(request => request.body.includes('revisionVersion'))
    expect(saveWrites).toHaveLength(1)
    expect(saveWrites[0].bytes).toBeLessThan(500 + count * 200)
    expect(fileRequests.size).toBe(fileStart)
    const confirmedMs = await page.evaluate(() => Math.round((window as any).__largePdfPaint.confirmed - (window as any).__largePdfPaint.start))
    saved.push({ changes: count, ms, confirmedMs, bytes: saveWrites[0].bytes, requests: saveWrites.length })
  }
  const after = await withE2eDatabase(async db => (await db.query('select id,x,y,page from line_scheme_points where revision_id=$1 order by id', [revisionId])).rows)
  expect(after).toHaveLength(1000)
  expect(after.filter((row, i) => row.x !== before[i].x || row.y !== before[i].y)).toHaveLength(25)
  await dialog.getByRole('button', { name: 'Закрыть схему' }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  await open()
  const persistedId = after.find((row, i) => row.x !== before[i].x)!.id
  await expect(dialog.locator(`[data-scheme-point="${persistedId}"]`)).toBeVisible()
  expect(await withE2eDatabase(async db => (await db.query('select id,x,y,page from line_scheme_points where revision_id=$1 order by id', [revisionId])).rows)).toEqual(after)
  await dialog.getByRole('button', { name: 'Закрыть схему' }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  expect(errors).toEqual([])
  await cdp.detach()
  console.log(JSON.stringify({ largePdf: { bytes: buffer.length, pages: 100, distinctScans: scans.length, points: 1000, uploadAndOpenMs, opens, fileBytes, networkOpenMs, networkOpenBytes, lastPageMs, frames, saved, workersAfterClose: page.workers().length } }))
})
