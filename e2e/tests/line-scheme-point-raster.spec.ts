import { expect, test } from '@playwright/test'
import { PDFDocument, degrees } from 'pdf-lib'
import { turnPdfPoint } from '../../src/lib/line-scheme-pdf-camera'
import { withE2eDatabase } from '../database'
import { filterSchemeProject } from '../line-scheme-grid'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'

const trackProject = schemeFixtureCleanup(test)

for (const [dpr, rotation] of [[1, 0], [2, 0], [1, 270], [2, 270]]) test.describe(`point pixels ${dpr}x rotation ${rotation}`, () => {
  test.use({ deviceScaleFactor: dpr })
  test('the painted marker tracks its saved coordinates while zooming', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const project = `E2E marker raster ${dpr}-${rotation}`, line = `RASTER-${dpr}-${rotation}`
    trackProject(testInfo, project)
    await withE2eDatabase(async db => {
      const id = (await db.query("insert into line_programs(project_title,subtitle_code,line,psto_assignment) values ($1,'RASTER',$2,'unassigned') returning id", [project, line])).rows[0].id
      await db.query("insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,connection_type,weld_date,has_vik,psto_required) values ($1,$2,'RASTER',$3,'S1','действующий','актуальная','С','2026-11-01','Да','Нет')", [id, project, line])
      await db.query("insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where line_program_id=$1", [id])
    })
    const pdf = await PDFDocument.create(); pdf.addPage(rotation ? [1191, 1684] : [842, 595]).setRotation(degrees(rotation))
    await page.goto('/line-schemes'); await filterSchemeProject(page, project)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
    await (await chooser).setFiles({ name: 'Raster.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) })
    await page.getByRole('dialog', { name: /^Файлы и архив линии/ }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true }), layer = dialog.locator('[data-scheme-point-layer="1"]')
    await expect(layer).toBeVisible()
    await dialog.getByRole('button', { name: 'S1', exact: true }).click()
    const area = (await layer.boundingBox())!
    await page.mouse.click(area.x + area.width * .4137, area.y + area.height * .4631)
    await dialog.getByRole('button', { name: /^Сохранить/ }).click()
    await expect(dialog.getByRole('button', { name: /^Сохранить/ })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'S1 Лист 1', exact: true })).toHaveAttribute('data-scheme-placement', 'saved')
    const marker = dialog.locator('[data-scheme-point]')
    const id = await marker.getAttribute('data-scheme-point')
    const readPoint = () => withE2eDatabase(async db => (await db.query('select x,y,page from line_scheme_points where id=$1', [id])).rows[0])
    const saved = await readPoint()
    // Compare the inherited-variable positioning used before direct camera
    // updates, without changing the app build or saved coordinates.
    if (process.env.E2E_PDF_POINT_INHERITED === '1') {
      await page.evaluate(() => {
        const sheet = document.querySelector<HTMLElement>('.line-scheme-pdf-sheet')!
        const sync = () => {
          for (const axis of ['width', 'height'] as const) {
            const name = `--scheme-page-${axis}`, value = sheet.style[axis]
            if (sheet.style.getPropertyValue(name) !== value) sheet.style.setProperty(name, value)
          }
        }
        new MutationObserver(sync).observe(sheet, { attributes: true, attributeFilter: ['style'] }); sync()
      })
      await page.addStyleTag({ content: `[data-scheme-point] { transform: translate(calc(var(--scheme-page-width) * ${saved.x} - 50%), calc(var(--scheme-page-height) * ${saved.y} - 50%)) rotate(var(--scheme-point-rotation)) !important; }` })
    }
    if (process.env.E2E_PDF_POINT_BASELINE === '1') await page.addStyleTag({ content: `[data-scheme-point] { left: ${Number(saved.x) * 100}% !important; top: ${Number(saved.y) * 100}% !important; transform: translate(-50%, -50%) rotate(var(--scheme-point-rotation, 0deg)) !important; }` })
    const first = (await marker.boundingBox())!
    const pointer = { x: first.x + first.width / 2, y: first.y + first.height / 2 }
    const clip = { x: Math.floor(pointer.x) - 20, y: Math.floor(pointer.y) - 20, width: 40, height: 40 }
    const samples: { x: number; y: number; domX: number; domY: number }[] = []
    for (let n = 0; n < 24; n++) {
      await page.evaluate(async pointer => {
        document.querySelector('.line-scheme-pdf-stage')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -.75, ctrlKey: true, clientX: pointer.x, clientY: pointer.y, bubbles: true, cancelable: true }))
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }, pointer)
      const png = await page.screenshot({ clip })
      if (n < 4) await testInfo.attach(`marker-${n}`, { body: png, contentType: 'image/png' })
      const centre = await page.evaluate(async ({ image, dpr }) => {
        const img = new Image(); img.src = `data:image/png;base64,${image}`; await img.decode()
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
        const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let weight = 0, x = 0, y = 0
        for (let row = 0; row < canvas.height; row++) for (let col = 0; col < canvas.width; col++) {
          const i = 4 * (row * canvas.width + col), r = data[i], g = data[i + 1], b = data[i + 2]
          if (r < 175 || g < 150 || b > 190) continue
          const w = Math.max(0, (r + g) / 2 - b)
          weight += w; x += (col + .5) * w; y += (row + .5) * w
        }
        if (!weight) throw new Error('No coloured marker in capture')
        return { x: x / weight / dpr, y: y / weight / dpr }
      }, { image: png.toString('base64'), dpr })
      const box = (await marker.boundingBox())!, sheet = (await dialog.locator('.line-scheme-pdf-sheet').boundingBox())!
      // MouseEvent coordinates are integers; the physical point may therefore
      // move slightly even when the supplied pointer is its fractional centre.
      // Measure raster error against the saved point's actual page position.
      const turned = turnPdfPoint({ x: Number(saved.x), y: Number(saved.y) }, rotation)
      const expectedX = sheet.x + turned.x * sheet.width, expectedY = sheet.y + turned.y * sheet.height
      samples.push({ x: centre.x + clip.x - expectedX, y: centre.y + clip.y - expectedY,
        domX: box.x + box.width / 2 - expectedX, domY: box.y + box.height / 2 - expectedY })
    }
    const spread = (key: keyof typeof samples[number]) => Math.max(...samples.map(s => s[key])) - Math.min(...samples.map(s => s[key]))
    const result = { dpr, rotation, paintedX: spread('x'), paintedY: spread('y'), domX: spread('domX'), domY: spread('domY') }
    console.log(JSON.stringify({ markerRaster: result }))
    await testInfo.attach('marker-samples', { body: JSON.stringify(samples), contentType: 'application/json' })
    if (process.env.E2E_PDF_POINT_BASELINE !== '1' && process.env.E2E_PDF_POINT_INHERITED !== '1') {
      expect(result.domX).toBeLessThan(.05); expect(result.domY).toBeLessThan(.05)
      expect(Math.max(...samples.flatMap(sample => [Math.abs(sample.domX), Math.abs(sample.domY)]))).toBeLessThan(.05)
      // Nested quarter-turn rasterization has subpixel antialiasing variation
      // even with the previous positioning (1x: 0.36px; direct: 0.35px).
      // Require less than half a device pixel for the new rotated fixture;
      // retain the original stricter, unrotated regression budget.
      const rasterBudget = rotation ? .5 / dpr : .15
      expect(result.paintedX).toBeLessThan(rasterBudget); expect(result.paintedY).toBeLessThan(rasterBudget)
    }
    expect(await readPoint()).toEqual(saved)
    await dialog.getByRole('button', { name: 'Закрыть схему', exact: true }).click()
    await expect.poll(() => page.workers().length).toBe(0)
  })
})
