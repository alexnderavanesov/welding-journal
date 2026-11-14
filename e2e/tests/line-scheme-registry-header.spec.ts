import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'
import { filterSchemeProject } from '../line-scheme-grid'

const trackProject = schemeFixtureCleanup(test)

test('scheme header stays at the viewport edge during scrolling, with live filters and aligned columns', async ({ page }, info) => {
  const project = `E2E sticky scheme ${info.project.name}`
  trackProject(info, project)
  await withE2eDatabase(db => db.query(`insert into line_programs(project_title, subtitle_code, line)
    select $1,'HEADER','LINE-'||lpad(n::text,3,'0') from generate_series(1,65) n`, [project]))
  await page.goto('/line-schemes')
  const registry = page.getByRole('region', { name: 'Схемы линий', exact: true })
  await filterSchemeProject(page, project)
  await expect(registry.getByText('1–50 из 65', { exact: true })).toBeVisible()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) requests.push(request.url()) })
  const header = registry.locator('.ag-header')
  const initialHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  await registry.locator('.ag-row').first().hover()
  await page.mouse.wheel(0, 450)
  await expect.poll(async () => Math.abs((await header.boundingBox())!.y)).toBeLessThan(1)
  // Read before the next scroll handler/animation frame: a fixed header must
  // not move with the document and then chase it back on the following frame.
  const movement = await header.evaluate(element => {
    const y = element.getBoundingClientRect().top, scroll = window.scrollY
    window.scrollBy(0, 100)
    return { scroll: window.scrollY - scroll, drift: element.getBoundingClientRect().top - y }
  })
  expect(movement.scroll).toBe(100)
  expect(Math.abs(movement.drift)).toBeLessThan(1)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(initialHeight)
  // Reverse direction repeatedly while the table remains under the header.
  const drift = await header.evaluate(async element => {
    const offsets = []
    for (const delta of [80, 80, -60, -60, 90, -90]) {
      window.scrollBy(0, delta)
      offsets.push(element.getBoundingClientRect().top)
      await new Promise(requestAnimationFrame)
      offsets.push(element.getBoundingClientRect().top)
    }
    return Math.max(...offsets.map(Math.abs))
  })
  expect(drift).toBeLessThan(1)
  expect(requests).toEqual([])
  await registry.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  await expect(page.getByRole('dialog', { name: 'Фильтр: Линия', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
  await page.screenshot({ path: info.outputPath('sticky-scheme-header.png') })
  await page.setViewportSize({ width: 900, height: 740 })
  const viewport = registry.locator('.ag-grid-viewport')
  await viewport.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  const aligned = async () => {
    const cell = registry.locator('.ag-row').first().locator('[col-id="files"]')
    const column = registry.locator('.ag-header-cell[col-id="files"]')
    const [body, head] = await Promise.all([cell.boundingBox(), column.boundingBox()])
    return Math.max(Math.abs(body!.x - head!.x), Math.abs(body!.width - head!.width))
  }
  await expect.poll(aligned).toBeLessThan(1)
  const handle = registry.locator('.ag-header-cell[col-id="files"] .ag-header-cell-resize')
  const bounds = (await handle.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down(); await page.mouse.move(bounds.x - 35, bounds.y + bounds.height / 2, { steps: 5 }); await page.mouse.up()
  await expect.poll(aligned).toBeLessThan(1)
  await registry.locator('.ag-header-cell[col-id="files"] .ag-header-cell-filter-button').click()
  await expect(page.getByRole('dialog', { name: 'Фильтр: Файлы и архив', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
  await page.screenshot({ path: info.outputPath('sticky-scheme-header-narrow.png') })
  // Pinned sections inside the fixed header must agree with the body's native
  // sticky columns in both engines, at the beginning/middle/end of the viewport.
  const files = registry.locator('.ag-header-cell[col-id="files"]')
  await files.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
  await page.getByText('Справа', { exact: true }).click()
  await viewport.evaluate(element => { element.scrollLeft = 0 })
  const line = registry.locator('.ag-header-cell[col-id="line"]')
  await line.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
  await page.getByText('Слева', { exact: true }).click()
  const pinned = () => registry.evaluate(element => {
    const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')!
    const header = element.querySelector<HTMLElement>('.scheme-stuck-header')!
    const box = (node: Element) => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height } }
    return { scrollLeft: viewport.scrollLeft, viewport: box(viewport), header: box(header), columns: ['line', 'files'].map(id => {
      const column = element.querySelector<HTMLElement>(`.ag-header-cell[col-id="${id}"]`)!
      const body = element.querySelector<HTMLElement>(`.ag-row .ag-cell[col-id="${id}"]`)!
      const section = column.closest('.ag-grid-pinned-left-cells, .ag-grid-pinned-right-cells')!
      const style = getComputedStyle(section)
      return { id, head: box(column), body: box(body), section: box(section), position: style.position, translate: style.translate, left: style.left, right: style.right }
    }) }
  })
  for (const offset of [0, 70, 9999]) {
    await viewport.evaluate((element, value) => { element.scrollLeft = value }, offset)
    try {
      await expect.poll(async () => Math.max(...(await pinned()).columns.map(column => Math.abs(column.head.x - column.body.x)))).toBeLessThan(1)
    } finally {
      await info.attach(`pinned-alignment-${offset}`, { contentType: 'application/json', body: JSON.stringify(await pinned()) })
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => header.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThan(20)
  await registry.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(registry.getByText('51–65 из 65', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  expect(errors).toEqual([])
})
