import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E плавная прокрутка'
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
})

async function seed(count: number) {
  await withE2eDatabase(db => db.query(`insert into weld_joints
    (project_title,subtitle_code,line,joint,connection_type,material_group,welding_method,
     d1,t1,d2,t2,has_vik,weld_date,element_1,element_2,responsible)
    select $1,'SCROLL','SCROLL-'||n,'F'||(9800+n),'С17','М01','РД',159,8,159,8,'да','2026-07-01',
      'Труба с длинным описанием материала','Труба','Ответственный за выполнение сварки'
    from generate_series(1,$2::int) n`, [project, count]))
}

for (const count of [74, 150]) test(`горизонтальный скролл: ${count} стыков, медленное движение без перестройки на каждом столбце`, async ({ page }, testInfo) => {
  await seed(count)
  await page.addInitScript(() => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
  })))
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(request.url()) })
  await page.goto('/journal')
  // Other files may leave their own fixtures in the shared disposable DB.
  // Keep this scenario below/above the 80-row virtualization boundary exactly.
  await page.getByPlaceholder('Поиск по отчету').fill('SCROLL-')
  await expect(page.getByText(`Записей: ${count} ·`, { exact: false })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const table = page.locator('table[data-horizontal-virtualized="true"]')
  await expect(table.locator('tbody tr[data-weld-row-id]').first()).toBeVisible()
  const hideMenu = page.getByRole('button', { name: 'Скрыть меню', exact: true })
  if (await hideMenu.count()) await hideMenu.click()
  await page.evaluate(() => window.scrollTo({ left: 800, top: 0, behavior: 'instant' }))
  await page.waitForTimeout(300)
  calls.length = 0
  const measured = await table.evaluate(async element => {
    const first = element.querySelector('tbody tr[data-weld-row-id]')!
    let patches = 0
    const observer = new MutationObserver(() => patches++)
    observer.observe(first, { childList: true, subtree: true, attributes: true, attributeFilter: ['colspan'] })
    const frames: number[] = [], longTasks: number[] = [], heights = new Set<number>()
    const performanceObserver = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(entry.duration)))
    performanceObserver.observe({ type: 'longtask' })
    let last = performance.now()
    for (let step = 0; step < 240; step++) {
      await new Promise<void>(resolve => requestAnimationFrame(time => {
        frames.push(time - last)
        last = time
        window.scrollTo({ left: 800 + step * 6, top: 0, behavior: 'instant' })
        heights.add(element.getBoundingClientRect().height)
        resolve()
      }))
    }
    await new Promise(resolve => setTimeout(resolve, 200))
    observer.disconnect()
    performanceObserver.disconnect()
    const sorted = frames.slice(2).sort((a, b) => a - b)
    return { patches, p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1), longTasks,
      heights: [...heights], cells: first.querySelectorAll('td').length,
      rows: element.querySelectorAll('tbody tr[data-weld-row-id]').length, scrollX: window.scrollX }
  })
  console.info(`Horizontal scroll ${count}:`, JSON.stringify(measured))
  await testInfo.attach('horizontal-scroll.json', { body: JSON.stringify(measured), contentType: 'application/json' })
  await page.screenshot({ path: `/private/tmp/welding-horizontal-scroll-${count}.png` })
  expect(measured.patches).toBeLessThanOrEqual(4)
  expect(measured.heights).toHaveLength(1)
  expect(measured.scrollX).toBe(2234)
  expect(measured.cells).toBeLessThan(45)
  if (count >= 80) expect(measured.rows).toBeLessThan(40)
  else expect(measured.rows).toBe(count)
  expect(calls).toEqual([])
  expect(errors).toEqual([])
})

for (const [path, report] of [['/journal', 'weldingJournal'], ['/lnk', 'lnk'], ['/psto', 'heatTreatment']]) {
  test(`${path}: колесо в обе стороны, дальние столбцы, фильтр и изменение ширины`, async ({ page }) => {
    await seed(74)
    await withE2eDatabase(db => db.query("update weld_joints set psto_required='да' where project_title=$1", [project]))
    await page.addInitScript(key => localStorage.setItem(`welding-report-view:v1:${key}`, JSON.stringify({
      activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
    })), report)
    const errors: string[] = [], calls: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(request.url()) })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const table = page.locator('table[data-horizontal-virtualized="true"]')
    await expect(table.locator('tbody tr[data-weld-row-id]').first()).toBeVisible()
    const noVisibleGaps = () => table.evaluate(element => {
      const sidebar = document.querySelector('[data-app-sidebar]')!.getBoundingClientRect().right
      return [...element.querySelectorAll('tbody tr[data-weld-row-id]:first-child td[data-horizontal-spacer]')].every(cell => {
        const rect = cell.getBoundingClientRect()
        return rect.right <= sidebar + 1 || rect.left >= innerWidth - 1
      })
    })
    for (const left of [800, 4200, 1500, 9500, 0, 800]) {
      await page.evaluate(x => window.scrollTo({ left: x, top: 0, behavior: 'instant' }), left)
      await expect.poll(noVisibleGaps).toBe(true)
    }
    await page.waitForTimeout(300)
    calls.length = 0
    const start = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
    const first = table.locator('tbody tr[data-weld-row-id]').first()
    const initialKeys = await first.locator('[data-weld-field-key]').evaluateAll(cells => cells.map(cell => cell.getAttribute('data-weld-field-key')))
    const position = (await first.boundingBox())!
    await page.mouse.move(1000, position.y + 20)
    for (const direction of [1, -1]) {
      for (let step = 0; step < 24; step++) {
        await page.mouse.wheel(direction * 6, 0)
        await page.waitForTimeout(20)
      }
      await expect.poll(noVisibleGaps).toBe(true)
      expect(await first.locator('[data-weld-field-key]').evaluateAll(cells => cells.map(cell => cell.getAttribute('data-weld-field-key')))).toEqual(initialKeys)
    }
    await expect.poll(() => page.evaluate(() => scrollX)).toBe(start.x)
    expect(await page.evaluate(() => scrollY)).toBe(start.y)
    const pinned = first.locator('td.sticky[data-weld-field-key]')
    expect(await pinned.evaluateAll(cells => cells.every(cell => /^rgb\(/.test(getComputedStyle(cell).backgroundColor)))).toBe(true)
    expect(calls).toEqual([])
    for (const width of [1100, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(noVisibleGaps).toBe(true)
    }
    await page.getByRole('button', { name: 'Линия. Открыть фильтр', exact: true }).click()
    const filter = page.getByRole('dialog', { name: 'Фильтр: Линия' })
    await expect(filter.getByPlaceholder('Найти значение')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(filter).toBeHidden()
    expect(errors).toEqual([])
  })
}
