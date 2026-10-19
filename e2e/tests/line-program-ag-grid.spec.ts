import { expect, test, type Locator, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E program AG Grid'
test.afterEach(() => cleanupLineProgramProjects([project]))

async function expectPageList(region: Locator, count: number) {
  await expect(region.locator('[data-program-grid="joints"]')).toHaveAttribute('data-program-row-count', String(count))
  await expect.poll(() => region.getByTestId('line-program-readonly-joint').count()).toBeGreaterThan(0)
  expect(await region.getByTestId('line-program-readonly-joint').count()).toBeLessThanOrEqual(55)
}
async function scrollToJoint(region: Locator, index: number, count: number) {
  const target = region.getByRole('button', { name: `F${index}`, exact: true })
  // Variable-height rows are measured as they enter the viewport. Re-evaluate
  // the document position rather than assuming all unrendered rows are 44px.
  await expect(async () => {
    await region.locator('[data-program-grid="joints"]').evaluate((element, { index, count }) => {
      const box = element.getBoundingClientRect()
      const row = element.querySelector(`[data-joint="F${index}"]`)
      window.scrollBy(0, row ? row.getBoundingClientRect().top - 160 : box.top + (box.height - 40) * (index - 1) / count - 180)
    }, { index, count })
    await expect(target).toBeInViewport({ timeout: 500 })
    expect(await target.evaluateAll(elements => elements[0]?.getBoundingClientRect().top ?? -1)).toBeGreaterThan(75)
  }).toPass({ timeout: 8000 })
}

async function selectFilterValue(page: Page, column: Locator, value: string) {
  await column.locator('.ag-header-cell-filter-button').click()
  const filter = page.locator('.ag-filter').filter({ visible: true })
  // The popup must fit a small table and stay above the assignments dialog.
  await expect(filter.getByRole('textbox')).toHaveCSS('height', '32px')
  await expect(filter.getByRole('textbox')).toHaveCSS('font-size', '13px')
  const popup = page.locator('.program-grid-popup.ag-filter-menu')
  expect((await popup.boundingBox())!.width).toBeLessThanOrEqual(300)
  for (const button of await filter.getByRole('button').all()) {
    expect(await button.evaluate(element => {
      const box = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    })).toBe(true)
  }
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('textbox').fill('__no_such_value__')
  await expect(filter.getByText('Нет совпадений', { exact: true })).toBeVisible()
  await filter.getByRole('textbox').fill(value)
  await filter.getByRole('checkbox', { name: value, exact: true }).check()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
}
async function resetFilter(page: Page, column: Locator) {
  await column.locator('.ag-header-cell-filter-button').click()
  const filter = page.locator('.ag-filter').filter({ visible: true })
  await filter.getByRole('button', { name: 'Сбросить', exact: true }).click()
  if (await filter.isVisible()) await filter.press('Escape')
}

test('one complete line: icon expansion, columns, value filters, shared draft and document actions', async ({ page }) => {
  const line = 'GRID-STATE'
  await withLineProgramFixture(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'GRID',$2,'II','A',10,0) returning id`, [project, line])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,stamp_1_k,stamp_1_z,has_vik,vik_result)
      select $1,$2,'GRID',$3,'F'||n,'2026-09-01','действующий','актуальная','С17','GRID-A','GRID-B','да','годен' from generate_series(1,3) n`, [program.id, project, line])
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1800, height: 1050 })
  await page.goto('/line-program')
  await expect(page.getByLabel('Итоги раздела')).toBeVisible()
  await page.getByLabel('Поиск программы линий').fill(line)
  const expand = page.getByRole('button', { name: `Расчёт линии ${line}`, exact: true })
  const plainCell = page.getByTestId('line-program-card').locator('.ag-cell[col-id="stamps"]')
  await plainCell.click()
  await expect(plainCell).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)')
  await expect(plainCell).toHaveCSS('box-shadow', 'none')
  await expect(expand).toHaveAttribute('aria-expanded', 'true')
  await expand.locator('svg path').click()
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expand.locator('svg path').click()
  await expect(expand).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('line-program-detail').getByRole('heading', { name: line, exact: true })).toBeVisible()
  await expect(page.getByTestId('line-program-detail')).toHaveClass(/program-line-needs-work/)
  await expect(page.getByRole('button', { name: 'Настроить вид программы линий', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: /группировку/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Клеймо GRID-A', exact: true }).locator('svg').first().click()
  const a = page.getByRole('region', { name: `Стыки клейма GRID-A · ${line}`, exact: true })
  await expect(a.getByTestId('line-program-readonly-joint')).toHaveCount(3)
  const column = a.getByRole('columnheader', { name: 'Стык', exact: true })
  await column.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'По возрастанию', exact: true }).press('Escape')
  const initialWidth = (await column.boundingBox())!.width
  const resize = (await column.locator('.ag-header-cell-resize').boundingBox())!
  await page.mouse.move(resize.x + resize.width / 2, resize.y + 15)
  await page.mouse.down(); await page.mouse.move(resize.x + 80, resize.y + 15); await page.mouse.up()
  const width = (await column.boundingBox())!.width
  expect(width).toBeGreaterThan(initialWidth + 50)
  // Column order is changed by a real header drag, without a settings/menu surface.
  const from = (await a.getByRole('columnheader', { name: 'Сварка / клейма', exact: true }).boundingBox())!
  const to = (await a.getByRole('columnheader', { name: 'Назначения', exact: true }).boundingBox())!
  await page.mouse.move(from.x + 35, from.y + 15); await page.mouse.down()
  await page.mouse.move(to.x + to.width - 12, to.y + 15, { steps: 12 }); await page.mouse.up()
  const columnOrder = () => a.getByRole('columnheader').evaluateAll(elements => elements.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(element => element.getAttribute('col-id')))
  const order = await columnOrder()
  expect(order.indexOf('assignments')).toBeLessThan(order.indexOf('welding'))
  await selectFilterValue(page, column, 'F2')
  await expand.click(); await expect(a).not.toBeVisible()
  await expand.click(); await expect(a.getByTestId('line-program-readonly-joint')).toHaveCount(1)
  await expect(a.getByTestId('line-program-readonly-joint')).toHaveCount(1)
  await expect.poll(async () => (await column.boundingBox())!.width).toBe(width)
  await expect(a.locator('.program-grid-toolbar, .program-grid-count')).toHaveCount(0)
  await a.getByRole('button', { name: 'Назначение F2: нет назначений', exact: true }).click()
  const editor = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
  await editor.getByRole('checkbox', { name: 'Выбрать F2', exact: true }).press('Space')
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F2', exact: true })).toBeChecked()
  await editor.getByRole('combobox', { name: 'F2 · РК', exact: true }).selectOption('да')
  await expect(editor.getByText('было: —', { exact: true })).toBeVisible()
  await editor.getByRole('combobox', { name: 'F2 · РК', exact: true }).press('Tab')
  await expect(editor.getByRole('combobox', { name: 'F2 · УЗК', exact: true })).toBeFocused()
  const jointColumn = editor.getByRole('columnheader', { name: 'Стык', exact: true })
  await selectFilterValue(page, jointColumn, 'F1')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(1)
  await expect(editor.getByText(/Выбрано вне текущего отбора: 1/)).toBeVisible()
  await editor.getByRole('checkbox', { name: 'Выбрать все доступные стыки', exact: true }).check()
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true })).toBeChecked()
  await editor.getByRole('checkbox', { name: 'Выбрать все доступные стыки', exact: true }).uncheck()
  await expect(editor.getByText(/Выбрано вне текущего отбора: 1/)).toBeVisible()
  await resetFilter(page, jointColumn)
  await editor.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
  await page.getByRole('button', { name: 'Клеймо GRID-B', exact: true }).click()
  const b = page.getByRole('region', { name: `Стыки клейма GRID-B · ${line}`, exact: true })
  await b.getByRole('button', { name: 'Назначение F2: нет назначений', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'F2 · РК', exact: true })).toHaveValue('да')
  await expect(editor.getByRole('button', { name: 'Проверить изменения' })).toBeEnabled()
  await editor.getByRole('button', { name: 'Отменить изменения', exact: true }).click()
  await page.getByRole('dialog', { name: 'Отменить изменения назначений?' }).getByRole('button', { name: 'Отменить изменения', exact: true }).click()
  await editor.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
  await page.reload()
  await expand.click()
  await page.getByRole('button', { name: 'Клеймо GRID-A', exact: true }).click()
  await expect(a.getByRole('textbox')).toHaveCount(0)
  await expect.poll(async () => (await column.boundingBox())!.width).toBe(width)
  expect(await columnOrder()).toEqual(order)
  await expect(a.getByTestId('line-program-readonly-joint')).toHaveCount(3)
  // Tiny tables fill their viewport without the old 150 px blank area or a trailing white column.
  const geometry = await a.getByRole('grid').evaluate(grid => {
    const rows = [...grid.querySelectorAll<HTMLElement>('.ag-row:not(.ag-full-width-row)')]
    const last = rows.at(-1)!.getBoundingClientRect(), header = grid.querySelector('.ag-header')!.getBoundingClientRect()
    return { blankBelow: grid.getBoundingClientRect().bottom - last.bottom, totalRows: rows.length, lastCellRight: rows[0].lastElementChild!.getBoundingClientRect().right, right: grid.getBoundingClientRect().right, headerHeight: header.height }
  })
  expect(geometry.blankBelow).toBeLessThan(5)
  expect(Math.abs(geometry.right - geometry.lastCellRight)).toBeLessThan(5)
  // Horizontal movement of the overview must not drag the open line workspace with it.
  await page.setViewportSize({ width: 1280, height: 900 })
  const detail = page.getByTestId('line-program-detail')
  // The frame and final footer must fit the master/detail row, including outer spacing.
  await expect.poll(() => detail.evaluate(element => {
    const row = element.closest('.ag-full-width-row')!.getBoundingClientRect()
    const bounds = element.getBoundingClientRect()
    return bounds.top >= row.top && bounds.bottom <= row.bottom
  })).toBe(true)
  const detailLeft = (await detail.boundingBox())!.x
  const overviewGrid = page.getByRole('grid', { name: 'Программа линий', exact: true })
  await overviewGrid.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await expect.poll(async () => (await detail.boundingBox())!.x).toBeCloseTo(detailLeft, 0)
  await overviewGrid.evaluate(element => { element.scrollLeft = 0 })
  const warmOpen: number[] = []
  for (let repeat = 0; repeat < 3; repeat++) {
    await expand.click(); await expect(detail).not.toBeVisible()
    const started = Date.now()
    await expand.click(); await expect(a.getByTestId('line-program-readonly-joint')).toHaveCount(3)
    warmOpen.push(Date.now() - started)
  }
  console.log(JSON.stringify({ workflow: 'one-line warm reopen', milliseconds: warmOpen }))
  await page.setViewportSize({ width: 1800, height: 1050 })
  expect(errors).toEqual([])
  await page.screenshot({ path: 'outputs/program-ux-line.png', fullPage: true })
})

for (const count of [50, 100, 120, 500]) test(`${count} joints under shared stamps: page scroll, independent expansion and bounded requests`, async ({ page }) => {
  const line = `GRID-${count}`
  await withLineProgramFixture(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'GRID',$2,'II','A',100,10) returning id`, [project, line])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,stamp_1_k,stamp_1_z,stamp_1_o,has_vik,vik_result)
      select $1,$2,'GRID',$3,'F'||n,'2026-09-01','действующий','актуальная','С17','GRID-A','GRID-B','GRID-C','да','годен' from generate_series(1,$4::int) n`, [program.id, project, line, count])
  })
  const calls: string[] = [], errors: string[] = [], warnings: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (/AG Grid: (error|warning)/.test(message.text())) warnings.push(message.text()) })
  await page.goto('/line-program')
  await expect(page.getByLabel('Итоги раздела')).toBeVisible()
  await page.getByLabel('Поиск программы линий').fill(line)
  await page.getByRole('button', { name: `Расчёт линии ${line}`, exact: true }).click()
  const metrics = await page.context().newCDPSession(page)
  await metrics.send('Performance.enable')
  const heap = async () => (await metrics.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'JSHeapUsedSize')!.value
  const beforeHeap = await heap()
  const started = Date.now()
  await page.getByRole('button', { name: 'Клеймо GRID-A', exact: true }).click()
  const a = page.getByTestId('stamp-joints-container').filter({ has: page.getByRole('region', { name: `Стыки клейма GRID-A · ${line}`, exact: true }) })
  await expectPageList(a, count)
  if (count === 120) {
    // Expand the joints first: the short collapsed page fits in the viewport
    // and cannot reach this scroll position. No headerless introductory gap.
    await page.getByTestId('line-program-detail').evaluate(element => window.scrollBy(0, element.getBoundingClientRect().top - 70))
    await expect(page.locator('[data-program-grid="lines"] > .program-grid-toolbar')).toHaveCount(0)
    await expect(page.locator('[data-program-grid="lines"] .program-stuck-control')).toHaveCount(1)
  }
  const measurements = await a.evaluate(element => ({ nodes: element.querySelectorAll('*').length, height: element.getBoundingClientRect().height,
    scrolls: [...element.querySelectorAll<HTMLElement>('*')].filter(node => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 2).length }))
  expect(measurements.scrolls).toBe(0)
  console.log(JSON.stringify({ workflow: 'AG Grid full stamp list', count, milliseconds: Date.now() - started, ...measurements }))
  const jointHeader = a.getByRole('columnheader', { name: 'Стык', exact: true })
  await selectFilterValue(page, jointHeader, `F${count}`)
  await expect(a.getByTestId('line-program-readonly-joint')).toHaveCount(1)
  await page.getByRole('button', { name: 'Клеймо GRID-B', exact: true }).click()
  const b = page.getByRole('region', { name: `Стыки клейма GRID-B · ${line}`, exact: true })
  await expectPageList(b, count)
  await expect(a.getByTestId('line-program-readonly-joint')).toHaveCount(1)
  await page.getByRole('button', { name: 'Клеймо GRID-A', exact: true }).click()
  await expect(a).not.toBeVisible()
  await page.getByRole('button', { name: 'Клеймо GRID-A', exact: true }).click()
  await expect(a.getByTestId('line-program-readonly-joint')).toHaveCount(1)
  await resetFilter(page, jointHeader)
  await scrollToJoint(b, count, count)
  await page.mouse.wheel(0, -250)
  await expect.poll(() => page.locator('.program-stuck-control').count()).toBe(1)
  const sticky = page.locator('.program-sticky-context')
  await expect(sticky).toContainText(`${line} · клейма GRID-B`)
  await expect.poll(() => sticky.evaluate(element => {
    const bar = element.getBoundingClientRect(), header = document.querySelector('.program-stuck-control')!.getBoundingClientRect()
    return bar.top >= 0 && Math.abs(bar.bottom - header.top) < 2 && header.bottom < innerHeight
  })).toBe(true)
  await expect(sticky).toHaveCSS('position', 'fixed')
  await expect(page.locator('[data-program-grid="lines"] > .program-grid-toolbar')).toHaveCount(0)
  console.log(JSON.stringify({ workflow: 'AG Grid two expanded shared stamps', count, heapBeforeMiB: beforeHeap / 1024 / 1024, heapAfterMiB: (await heap()) / 1024 / 1024, nodes: await page.locator('[data-program-grid="joints"] *').count() }))
  if (count === 120) {
    await scrollToJoint(b, 80, count)
    const historyJoint = b.getByTestId('line-program-readonly-joint').filter({ has: page.getByRole('button', { name: 'F80', exact: true }) })
    for (let repeat = 0; repeat < 2; repeat++) {
      await historyJoint.getByRole('button', { name: 'F80', exact: true }).click()
      await expect(historyJoint.getByRole('button', { name: 'F80', exact: true })).toHaveAttribute('aria-expanded', 'true')
      const history = b.locator('.ag-full-width-row').filter({ visible: true }).first()
      await history.evaluate(element => window.scrollBy(0, element.getBoundingClientRect().top - 15))
      await expect.poll(() => b.locator('.program-stuck-control').count()).toBe(1)
      await expect(sticky).toContainText('GRID-B')
      await expect(historyJoint).not.toHaveClass(/program-joint-highlighted/)
      await historyJoint.getByRole('button', { name: 'F80', exact: true }).click()
    }
    // Finish collapsing history before checking hover: moving rows can pass
    // back under the stationary pointer after Playwright dispatches the move.
    await expect(b.locator('[data-program-motion]')).toHaveCount(0)
    const firstHover = b.getByTestId('line-program-readonly-joint').filter({ has: page.getByRole('button', { name: 'F79', exact: true }) })
    await firstHover.hover()
    const secondHover = b.getByTestId('line-program-readonly-joint').filter({ has: page.getByRole('button', { name: 'F80', exact: true }) })
    await secondHover.hover()
    await expect.poll(() => firstHover.evaluate(element => element.matches(':hover'))).toBe(false)
    await expect.poll(() => secondHover.evaluate(element => element.matches(':hover'))).toBe(true)
    await expect(firstHover).not.toHaveClass(/ag-row-hover/)
    await expect(secondHover).toHaveCSS('background-color', 'rgba(209, 250, 229, 0.6)')
    // Sample animation frames during actual wheel scrolling; report scope instead of treating total test time as FPS.
    await page.evaluate(() => {
      const state = { times: [] as number[], drift: [] as number[], running: true, last: performance.now() }
      ;(window as any).__programScrollFrames = state
      const sample = (now: number) => {
        state.times.push(now - state.last); state.last = now
        const bar = document.querySelector('.program-sticky-context:not([hidden])')?.getBoundingClientRect()
        const top = 0
        if (bar) state.drift.push(Math.abs(bar.top - top))
        if (state.running) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    for (let step = 0; step < 12; step++) { await page.mouse.wheel(0, step < 6 ? -90 : 90); await page.waitForTimeout(30) }
    const frames = await page.evaluate(() => {
      const state = (window as any).__programScrollFrames; state.running = false
      const times = (state.times as number[]).slice(1).sort((a, b) => a - b)
      return { samples: times.length, p95: times[Math.floor(times.length * .95)], max: times.at(-1), maxHeaderDrift: Math.max(...state.drift) }
    })
    console.log(JSON.stringify({ workflow: 'page wheel scroll, two 120-joint stamps', ...frames }))
    expect(frames.maxHeaderDrift).toBeLessThanOrEqual(1)
    await page.screenshot({ path: 'outputs/program-ux-sticky-polish.png' })
    // Real native controls remain interactive while their header is pinned to page scroll.
    await page.setViewportSize({ width: 1100, height: 1000 })
    const column = b.getByRole('columnheader', { name: 'Стык', exact: true })
    await column.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
    await page.getByText('Слева', { exact: true }).click()
    const viewport = b.locator('.ag-grid-viewport').first()
    await viewport.evaluate(element => { element.scrollLeft = 70 })
    expect(await viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(20)
    await expect.poll(() => column.evaluate(element => {
      const grid = element.closest('[data-program-grid]')!
      const bodyCell = grid.querySelector('.ag-cell[col-id="joint"]')!
      return Math.abs(element.getBoundingClientRect().left - bodyCell.getBoundingClientRect().left)
    })).toBeLessThan(1)
    const right = b.getByRole('columnheader', { name: 'Сварка / клейма', exact: true })
    await right.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
    await page.getByText('Справа', { exact: true }).click()
    await viewport.evaluate(element => { element.scrollLeft = 90 })
    for (const scroll of [0, 90, 9999]) {
      await viewport.evaluate((element, value) => { element.scrollLeft = value }, scroll)
      for (const header of [column, right]) await expect.poll(() => header.evaluate(element => {
        const body = element.closest('[data-program-grid]')!.querySelector(`.ag-cell[col-id="${element.getAttribute('col-id')}"]`)!
        return Math.abs(element.getBoundingClientRect().left - body.getBoundingClientRect().left)
      })).toBeLessThan(1)
    }
    await viewport.evaluate(element => { element.scrollLeft = 0 })
    const before = (await column.boundingBox())!.width
    const handle = (await column.locator('.ag-header-cell-resize').boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 10)
    await page.mouse.down(); await page.mouse.move(handle.x + 40, handle.y + 10); await page.mouse.up()
    await expect.poll(async () => (await column.boundingBox())!.width).toBeGreaterThan(before + 20)
    const scrollPositions = () => page.evaluate(() => [document.scrollingElement?.scrollTop ?? 0, ...[...document.querySelectorAll<HTMLElement>('*')].filter(element => element.scrollTop > 0).map(element => element.scrollTop)])
    const beforeFilterScroll = await scrollPositions()
    await column.locator('.ag-header-cell-filter-button').click()
    const filter = page.locator('.ag-filter').filter({ visible: true })
    await page.screenshot({ path: 'outputs/program-ux-filter-polish.png' })
    const popupBox = (await page.locator('.program-grid-popup.ag-filter-menu').boundingBox())!
    await page.screenshot({ path: 'outputs/program-ux-filter-detail.png', clip: { x: popupBox.x - 20, y: popupBox.y - 36, width: popupBox.width + 40, height: popupBox.height + 56 } })
    await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
    await filter.getByRole('textbox').fill('F120')
    await filter.getByRole('checkbox', { name: 'F120', exact: true }).check()
    expect(await scrollPositions()).toEqual(beforeFilterScroll)
    await filter.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(b.getByTestId('line-program-readonly-joint')).toHaveCount(1)
    await expect(b.getByRole('button', { name: 'F120', exact: true })).toBeVisible()
    await page.getByRole('button', { name: `Расчёт линии ${line}`, exact: true }).click()
    await expect(page.locator('.program-sticky-spacer')).toHaveCount(0)
    await expect(page.locator('.program-stuck-control')).toHaveCount(0)
  }
  if (count === 100) {
    await scrollToJoint(b, 1, count)
    const firstCell = b.getByTestId('line-program-readonly-joint').filter({ has: page.getByRole('button', { name: 'F1', exact: true }) }).locator('.ag-cell[col-id="joint"]')
    await firstCell.focus()
    const beforeKeyboard = await page.evaluate(() => window.scrollY)
    await page.keyboard.press('PageDown')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeKeyboard + 100)
    await page.keyboard.press('End')
    await expect.poll(() => b.getByRole('button', { name: 'F100', exact: true }).evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.top >= 72 && box.bottom <= innerHeight
    })).toBe(true)
    await page.keyboard.press('Home')
    await expect.poll(() => b.getByRole('button', { name: 'F1', exact: true }).evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.top >= 72 && box.bottom <= innerHeight
    })).toBe(true)
    const times: number[] = [], filters: number[] = []
    await page.evaluate(() => {
      const samples: { action: string; milliseconds: number }[] = [], longTasks: number[] = []
      const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(entry.duration) })
      observer.observe({ type: 'longtask' })
      const listener = (event: Event) => {
        const label = (event.target as Element).closest('button')?.textContent?.trim()
        if (!['Все стыки линии', 'По клеймам', 'Применить', 'Сбросить'].includes(label ?? '')) return
        const start = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => samples.push({ action: label!, milliseconds: Math.round(performance.now() - start) })))
      }
      document.addEventListener('click', listener, true)
      ;(window as any).__programInteractionSamples = { samples, longTasks, stop: () => { observer.disconnect(); document.removeEventListener('click', listener, true) } }
    })
    for (let i = 0; i < 4; i++) {
      const start = Date.now()
      await page.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
      await expect(page.getByTestId('line-program-all-joints')).toBeVisible()
      await page.getByRole('button', { name: 'По клеймам', exact: true }).click()
      await expect(a).toBeVisible()
      times.push(Date.now() - start)
      const filtering = Date.now()
      await selectFilterValue(page, jointHeader, 'F100')
      await expect(a.getByTestId('line-program-readonly-joint')).toHaveCount(1)
      await resetFilter(page, jointHeader)
      await expectPageList(a, 100)
      filters.push(Date.now() - filtering)
    }
    console.log(JSON.stringify({ workflow: '100-row application tab/filter round trips (first cold)', tabsMs: times, filterMs: filters }))
    console.log(JSON.stringify(await page.evaluate(() => {
      const measured = (window as any).__programInteractionSamples
      measured.stop()
      return { workflow: '100-row actual click to second animation frame', samples: measured.samples, longTasksMs: measured.longTasks }
    })))
  }
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  for (const prefix of ['getLineProgramCalculation_', 'getLineProgramJointPage_']) expect(calls.filter(call => call.startsWith(prefix))).toHaveLength(1)
  await metrics.detach()
  expect(errors).toEqual([])
  expect(warnings).toEqual([])
  await page.screenshot({ path: `outputs/program-ag-grid-${count}.png` })
  if (count === 100 && process.env.PROGRAM_PROTOTYPE_URL) {
    // Optional comparison against the user's local sketch, never production.
    const url = new URL(process.env.PROGRAM_PROTOTYPE_URL)
    expect(['127.0.0.1', 'localhost']).toContain(url.hostname)
    await page.goto(url.href)
    await page.getByRole('button', { name: 'Развернуть линию ДЕМО-100', exact: true }).click()
    const start = Date.now()
    await page.getByRole('button', { name: 'Развернуть клеймо АК12', exact: true }).click()
    const list = page.locator('.stamp-joints-grid')
    await expect(list.locator('.ag-row[row-id]')).toHaveCount(100)
    console.log(JSON.stringify({ workflow: '100-row sketch first stamp', milliseconds: Date.now() - start }))
    const tabs: number[] = [], filters: number[] = []
    for (let i = 0; i < 4; i++) {
      const begin = Date.now()
      await page.getByRole('button', { name: /^Все стыки линии/ }).click()
      await expect(page.getByRole('combobox', { name: 'Клеймо в списке стыков' })).toBeVisible()
      await page.getByRole('button', { name: /^По клеймам/ }).click()
      await expect(list.locator('.ag-row[row-id]')).toHaveCount(100)
      tabs.push(Date.now() - begin)
      const filtering = Date.now()
      const search = page.getByPlaceholder('Поиск по стыкам клейма')
      await search.fill('F100')
      await expect(list.locator('.ag-row[row-id]')).toHaveCount(1)
      await search.fill('')
      await expect(list.locator('.ag-row[row-id]')).toHaveCount(100)
      filters.push(Date.now() - filtering)
    }
    console.log(JSON.stringify({ workflow: '100-row sketch tab/filter round trips', tabsMs: tabs, filterMs: filters }))
  }
})

test('short and filtered all-joint lists fit content; header grouping, pinning and reset preserve workflows', async ({ page }) => {
  const line = 'GRID-SHORT'
  await withLineProgramFixture(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'GRID',$2,'II','A',100,10) returning id`, [project, line])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,stamp_1_k,has_vik,vik_result)
      select $1,$2,'GRID',$3,'F'||n,'2026-09-01','действующий','актуальная','С17','GRID-A','да','годен' from generate_series(1,5) n`, [program.id, project, line])
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1800, height: 1050 })
  await page.goto('/line-program')
  await expect(page.getByLabel('Итоги раздела')).toBeVisible()
  await page.getByLabel('Поиск программы линий').fill(line)
  const expand = page.getByRole('button', { name: `Расчёт линии ${line}`, exact: true })
  await expand.locator('svg path').click()
  await expect(expand).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  const all = page.getByRole('region', { name: `Стыки всей линии · ${line}`, exact: true })
  await expect(all.getByTestId('line-program-readonly-joint')).toHaveCount(5)
  const gap = () => all.evaluate(element => {
    const last = [...element.querySelectorAll('[data-testid="line-program-readonly-joint"]')].at(-1)!.getBoundingClientRect()
    return element.querySelector('.program-grid-frame')!.getBoundingClientRect().bottom - last.bottom
  })
  await expect.poll(gap).toBeLessThan(20)
  await all.getByRole('button', { name: 'F1', exact: true }).locator('svg').click()
  await expect(all.getByRole('button', { name: 'F1', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await all.getByRole('button', { name: 'F1', exact: true }).locator('svg').click()
  await expect(all.getByRole('button', { name: 'F1', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(all.locator('.program-grid-toolbar, .program-grid-count')).toHaveCount(0)
  const joint = all.getByRole('columnheader', { name: 'Стык', exact: true })
  await selectFilterValue(page, joint, 'F3')
  await expect(all.getByTestId('line-program-readonly-joint')).toHaveCount(1)
  await expect.poll(gap).toBeLessThan(20)
  await joint.locator('.ag-header-cell-filter-button').click()
  await page.locator('.ag-filter').filter({ visible: true }).getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await page.locator('.ag-filter').filter({ visible: true }).getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(all.getByTestId('line-program-readonly-joint')).toHaveCount(0)
  expect((await all.boundingBox())!.height).toBeLessThan(220)
  await resetFilter(page, joint)
  await expect(all.getByTestId('line-program-readonly-joint')).toHaveCount(5)
  const welding = all.getByRole('columnheader', { name: 'Сварка / клейма', exact: true })
  await welding.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: /Группировать/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'По возрастанию', exact: true }).press('Escape')
  await expand.click(); await expect(all).not.toBeVisible()
  await expand.click(); await expect(all.getByTestId('line-program-readonly-joint')).toHaveCount(5)
  await joint.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
  await page.getByText('Слева', { exact: true }).click()
  await page.setViewportSize({ width: 1050, height: 1000 })
  const viewport = all.locator('.ag-grid-viewport').first()
  await viewport.evaluate(element => { element.scrollLeft = 160 })
  await expect.poll(() => joint.evaluate(element => Math.abs(element.getBoundingClientRect().left - element.closest('[data-program-grid]')!.querySelector('.ag-cell[col-id="joint"]')!.getBoundingClientRect().left))).toBeLessThan(1)
  await joint.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Выбрать столбцы', exact: true }).click()
  const chooser = page.getByRole('dialog', { name: 'Выбрать столбцы', exact: true })
  await expect(chooser).toBeVisible()
  await chooser.getByRole('treeitem', { name: /^Результаты / }).getByRole('checkbox').uncheck()
  await chooser.press('Escape')
  await expect(all.getByRole('columnheader', { name: 'Результаты', exact: true })).toHaveCount(0)
  await joint.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Сбросить столбцы', exact: true }).click()
  await expect(all.getByRole('columnheader', { name: 'Результаты', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1800, height: 1050 })
  await all.getByRole('button', { name: 'Назначение F2: нет назначений', exact: true }).click()
  const editor = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
  await editor.getByRole('combobox', { name: 'F2 · РК', exact: true }).selectOption('да')
  await editor.getByRole('columnheader', { name: 'РК', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
  await page.getByText('Слева', { exact: true }).click()
  await editor.getByRole('columnheader', { name: 'РК', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Выбрать столбцы', exact: true }).click()
  await chooser.getByRole('treeitem', { name: /^Результат / }).getByRole('checkbox').uncheck()
  await chooser.press('Escape')
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('columnheader', { name: 'Результат', exact: true })).toHaveCount(0)
  await editor.getByRole('columnheader', { name: 'РК', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Сбросить столбцы', exact: true }).click()
  await editor.getByRole('columnheader', { name: 'РК', exact: true }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: /Группировать/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'По возрастанию', exact: true }).press('Escape')
  await expect(editor.getByRole('combobox', { name: 'F2 · РК', exact: true })).toHaveValue('да')
  await editor.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
  const timings: number[] = []
  for (let i = 0; i < 4; i++) {
    const start = Date.now()
    await page.getByRole('button', { name: 'По клеймам', exact: true }).click()
    await expect(all).not.toBeVisible()
    await page.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
    await expect(all.getByTestId('line-program-readonly-joint')).toHaveCount(5)
    timings.push(Date.now() - start)
  }
  await all.getByRole('button', { name: 'Назначение F2: нет назначений', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'F2 · РК', exact: true })).toHaveValue('да')
  await editor.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
  console.log(JSON.stringify({ workflow: 'five-row warm tab round trips', milliseconds: timings }))
  await page.waitForTimeout(250)
  const idleFrames = await page.evaluate(async () => {
    const original = window.requestAnimationFrame
    let scheduled = 0
    window.requestAnimationFrame = callback => { scheduled++; return original(callback) }
    await new Promise(resolve => setTimeout(resolve, 300))
    window.requestAnimationFrame = original
    return scheduled
  })
  expect(idleFrames).toBeLessThan(12)
  console.log(JSON.stringify({ workflow: 'idle scheduled frame callbacks over 300ms', count: idleFrames }))
  await page.screenshot({ path: 'outputs/program-ux-short-list.png', fullPage: true })
  expect(errors).toEqual([])
})

test('minimal overview: inline control, compact full-width groups and no native browser menu', async ({ page }) => {
  await withLineProgramFixture(async db => {
    for (const [line, count] of [['MINIMAL-A', 2], ['MINIMAL-B', 3], ['MINIMAL-C', 2]] as const) {
      const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
        values ($1,'GRID',$2,'II','A',100,10) returning id`, [project, line])
      await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,stamp_1_k,has_vik,vik_result,has_rk)
        select $1,$2,'GRID',$3,'F'||n,'2026-09-01','действующий','актуальная','С17','GRID-A','да','годен','дополнительный' from generate_series(1,$4::int) n`, [program.id, project, line, count])
    }
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1800, height: 1000 })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill('MINIMAL-')
  const cards = page.getByTestId('line-program-card')
  await expect(cards).toHaveCount(3)
  const first = cards.filter({ has: page.getByTestId('line-name').filter({ hasText: 'MINIMAL-A' }) })
  await expect(first.getByRole('button', { name: 'Дополнительные стыки: 2', exact: true })).toHaveText('Доп: 2')
  await expect(first.getByRole('button', { name: 'Ещё показатели контроля' })).toHaveCount(0)
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS('box-shadow', 'none')
    await expect(card).toHaveCSS('background-color', 'rgb(237, 246, 253)')
  }
  const column = page.getByRole('columnheader', { name: 'Соединений', exact: true })
  await column.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Группировать по «Соединений»', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: 'Группа', exact: true })).toHaveCount(0)
  const groups = page.locator('.program-group-label')
  await expect(groups).toHaveCount(2)
  await expect(groups.filter({ hasText: 'Соединений: 2' })).toContainText('Линий: 2')
  for (const group of await groups.all()) expect(await group.evaluate(element => element.closest('.ag-row')!.getBoundingClientRect().height)).toBeLessThanOrEqual(40)
  await page.getByRole('columnheader', { name: 'Линия', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Свернуть все', exact: true }).click()
  await expect(cards).toHaveCount(0)
  await page.getByRole('columnheader', { name: 'Линия', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Развернуть все', exact: true }).click()
  await expect(cards).toHaveCount(3)
  await expect(page.getByTestId('line-program-detail')).toHaveCount(0)
  await first.getByRole('button', { name: 'Дополнительные стыки: 2', exact: true }).click()
  await expect(page.getByTestId('line-program-all-joints')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Свернуть линию', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('line-program-detail')).toHaveCSS('border-left-width', '4px')
  await expect(page.getByTestId('line-program-detail')).toHaveCSS('border-radius', '10px')
  await expect(page.locator('.program-grid-count, [data-testid="program-stamp-guide"]')).toHaveCount(0)
  // Keep the event until dispatch has finished: a microtask inside a native
  // capture listener may run before AG Grid's target/bubble listeners.
  await page.evaluate(() => { document.addEventListener('contextmenu', event => { (window as any).__programContextEvent = event }, { once: true, capture: true }) })
  await page.getByTestId('line-program-all-joints').getByRole('columnheader', { name: 'Стык', exact: true }).click({ button: 'right' })
  expect(await page.evaluate(() => (window as any).__programContextEvent.defaultPrevented)).toBe(true)
  await expect(page.getByRole('menuitem', { name: /Группировать/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'По возрастанию', exact: true }).press('Escape')
  await page.getByRole('button', { name: 'Расчёт линии MINIMAL-A', exact: true }).click()
  await page.getByRole('button', { name: 'Открыть назначения линии MINIMAL-A', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Назначения · MINIMAL-A', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
  await page.getByRole('button', { name: 'Расчёт линии MINIMAL-A', exact: true }).click()
  await page.screenshot({ path: 'outputs/program-minimal-groups.png', fullPage: true })
  await page.getByRole('button', { name: 'Убрать группировку Соединений', exact: true }).click()
  await expect(groups).toHaveCount(0)
  await page.screenshot({ path: 'outputs/program-minimal-overview.png', fullPage: true })
  expect(errors).toEqual([])
})
