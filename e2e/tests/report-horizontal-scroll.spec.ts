import { expect, test, type Locator, type Page } from '@playwright/test'
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

async function journalHasNoVisibleGaps(grid: Locator) {
  return grid.evaluate(element => {
    const viewport = element.querySelector('.ag-grid-viewport')!.getBoundingClientRect()
    const row = element.querySelector('.ag-grid-scrolling-rows .ag-row[row-index="0"]')
    if (!row) return false
    const cells = [...row.querySelectorAll<HTMLElement>('.ag-cell')].map(cell => ({ cell, rect: cell.getBoundingClientRect() }))
      .filter(({ rect }) => rect.right > viewport.left && rect.left < viewport.right)
      .sort((a, b) => a.rect.left - b.rect.left)
    let covered = viewport.left
    for (const { cell, rect } of cells) {
      if (rect.left > covered + 2) return false
      covered = Math.max(covered, rect.right)
      const header = element.querySelector(`.ag-header-cell[col-id="${CSS.escape(cell.getAttribute('col-id')!)}"]`)
      if (!header) return false
      const headerRect = header.getBoundingClientRect()
      if (Math.abs(headerRect.left - rect.left) > 2 || Math.abs(headerRect.width - rect.width) > 2) return false
    }
    return cells.length > 0 && covered >= viewport.right - 2
  })
}

async function checkJournalHorizontalNavigation(page: Page, calls: string[], report = 'weldingJournal') {
  const grid = page.locator(`[data-weld-report-grid="${report}"]`)
  const viewport = grid.locator('.ag-grid-viewport')
  // The result count can update before the search transition removes the old
  // row at index 0. Wait for the ready, unique row before measuring its geometry.
  await expect(grid.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  const firstRow = grid.locator('.ag-grid-scrolling-rows .ag-row[row-index="0"]')
  await expect(firstRow).toHaveCount(1)
  await expect(firstRow).toBeVisible()
  await expect(firstRow.getByRole('checkbox')).toBeEnabled()
  const noVisibleGaps = () => journalHasNoVisibleGaps(grid)
  const line = grid.locator('.ag-grid-scrolling-rows .ag-row[row-index="0"] [col-id="line"]')
  const pinnedLeft = (await line.boundingBox())!.x
  for (const left of [800, 4200, 1500, 9500, 0, 800]) {
    const actualLeft = await viewport.evaluate((element, value) => {
      const target = Math.min(value, element.scrollWidth - element.clientWidth)
      element.scrollLeft = target
      return target
    }, left)
    await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBe(actualLeft)
    await expect.poll(noVisibleGaps).toBe(true)
    expect((await line.boundingBox())!.x).toBe(pinnedLeft)
  }
  await page.waitForTimeout(300)
  calls.length = 0
  const start = await viewport.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop, pageX: scrollX, pageY: scrollY }))
  const box = (await viewport.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 30)
  for (const direction of [1, -1]) {
    for (let step = 0; step < 24; step++) {
      await page.mouse.wheel(direction * 6, 0)
      await page.waitForTimeout(20)
    }
    await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBe(direction === 1 ? start.x + 144 : start.x)
    await expect.poll(noVisibleGaps).toBe(true)
    expect((await line.boundingBox())!.x).toBe(pinnedLeft)
  }
  expect(await viewport.evaluate(element => ({ y: element.scrollTop, pageX: scrollX, pageY: scrollY }))).toEqual({ y: start.y, pageX: start.pageX, pageY: start.pageY })
  expect(calls).toEqual([])
  for (const width of [1100, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(noVisibleGaps).toBe(true)
  }
  await grid.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Линия', exact: true })
  await expect(filter.getByRole('textbox', { name: 'Найти значение фильтра' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(filter).toBeHidden()
  await expect.poll(noVisibleGaps).toBe(true)
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
  // Keep both former boundary sizes, but AG Grid virtualises either size.
  // Other files may leave their own fixtures in the shared disposable DB.
  await page.getByPlaceholder('Поиск по отчету').fill('SCROLL-')
  await expect(page.getByText(`Записей: ${count} ·`, { exact: false })).toBeVisible()
  await page.getByRole('combobox', { name: 'Размер порции строк' }).selectOption('300')
  await expect(page.getByText(`Загружено: ${count} из ${count}`, { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const table = page.locator('[data-welding-journal-grid]')
  await expect(table.locator('.ag-grid-scrolling-rows .ag-row[row-index="0"]')).toBeVisible()
  const hideMenu = page.getByRole('button', { name: 'Скрыть меню', exact: true })
  if (await hideMenu.count()) await hideMenu.click()
  await table.locator('.ag-grid-viewport').evaluate(element => { element.scrollLeft = 800 })
  await expect.poll(() => journalHasNoVisibleGaps(table)).toBe(true)
  await page.waitForTimeout(300)
  calls.length = 0
  const measured = await table.evaluate(async element => {
    const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')!
    const first = element.querySelector('.ag-grid-scrolling-rows .ag-row[row-index="0"]')!
    const line = first.querySelector('[col-id="line"]')!
    const initialLineLeft = line.getBoundingClientRect().left
    let rowReplacements = 0, pinnedDrift = 0, maxCells = 0, maxRows = 0
    const observer = new MutationObserver(records => {
      for (const record of records) if ([...record.removedNodes].includes(first)) rowReplacements++
    })
    observer.observe(first.parentElement!, { childList: true })
    const frames: number[] = [], longTasks: number[] = [], heights = new Set<number>()
    const performanceObserver = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(entry.duration)))
    performanceObserver.observe({ type: 'longtask' })
    let last = performance.now()
    for (let step = 0; step < 240; step++) {
      await new Promise<void>(resolve => requestAnimationFrame(time => {
        frames.push(time - last)
        last = time
        viewport.scrollLeft = 800 + step * 6
        heights.add(element.getBoundingClientRect().height)
        pinnedDrift = Math.max(pinnedDrift, Math.abs(line.getBoundingClientRect().left - initialLineLeft))
        maxCells = Math.max(maxCells, first.querySelectorAll('.ag-cell').length)
        maxRows = Math.max(maxRows, element.querySelectorAll('.ag-grid-scrolling-rows .ag-row').length)
        resolve()
      }))
    }
    await new Promise(resolve => setTimeout(resolve, 200))
    observer.disconnect()
    performanceObserver.disconnect()
    const sorted = frames.slice(2).sort((a, b) => a - b)
    return { rowReplacements, originalRowConnected: first.isConnected, pinnedDrift,
      p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1), longTasks,
      heights: [...heights], maxCells, maxRows, scrollLeft: viewport.scrollLeft, pageScrollX: window.scrollX }
  })
  console.info(`Horizontal scroll ${count}:`, JSON.stringify(measured))
  await testInfo.attach('horizontal-scroll.json', { body: JSON.stringify(measured), contentType: 'application/json' })
  await page.screenshot({ path: `/private/tmp/welding-horizontal-scroll-${count}.png` })
  expect(measured.rowReplacements).toBe(0)
  expect(measured.originalRowConnected).toBe(true)
  expect(measured.pinnedDrift).toBeLessThan(2)
  expect(measured.heights).toHaveLength(1)
  expect(measured.scrollLeft).toBe(2234)
  expect(measured.pageScrollX).toBe(0)
  expect(measured.maxCells).toBeLessThan(45)
  expect(measured.maxRows).toBeGreaterThan(0)
  expect(measured.maxRows).toBeLessThan(60)
  await expect.poll(() => journalHasNoVisibleGaps(table)).toBe(true)
  await expect(page.getByText(`Загружено: ${count} из ${count}`, { exact: true })).toBeVisible()
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
    await page.getByPlaceholder('Поиск по отчету').fill(project)
    await expect(page.getByText(report === 'lnk' ? 'из 74 строк' : 'Загружено: 74 из 74', { exact: true })).toBeVisible()
    // The initial dispatcher refresh can complete after the first rows render
    // and legitimately refetch them. Finish setup before measuring scroll RPCs.
    await page.waitForLoadState('networkidle')
    if (report === 'weldingJournal' || report === 'heatTreatment') {
      await checkJournalHorizontalNavigation(page, calls, report)
      expect(errors).toEqual([])
      return
    }
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
