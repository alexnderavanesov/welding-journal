import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { observeGridResults } from '../grid-result-motion'

// Frame measurements must exclude Playwright's synchronous DOM snapshots and video capture.
test.use({ trace: 'off', video: 'off' })

const project = 'E2E program disclosure'
test.afterEach(() => cleanupLineProgramProjects([project]))
test.beforeEach(async ({ page }) => {
  await withLineProgramFixture(async db => {
    for (let i = 1; i <= 12; i++) {
      const line = `MOTION-${String(i).padStart(2, '0')}`
      const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
        values ($1,'MOTION',$2,'II','A',100,100) returning id`, [project, line])
      await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,stamp_1_k,stamp_1_z,has_vik,vik_result)
        select $1,$2,'MOTION',$3,'F'||n,'2026-09-01','действующий','актуальная','С17','MOTION-A','MOTION-B','да','годен' from generate_series(1,5) n`, [program.id, project, line])
    }
  })
  await page.goto('/line-program')
  await expect(page.getByLabel('Итоги раздела')).toBeVisible()
  await page.getByLabel('Поиск программы линий').fill('MOTION-')
  await expect(page.getByTestId('line-program-card')).toHaveCount(12)
})

async function settle(page: Page) {
  await expect(page.locator('[data-program-motion]')).toHaveCount(0)
}

test('program results reveal through repeated sorts, filter, empty result and reset without replacing the grid', async ({ page }) => {
  const grid = page.locator('[data-program-grid="lines"]')
  const retained = (await grid.locator('.ag-root').elementHandle())!
  const motion = await observeGridResults(page, '[data-program-grid="lines"] > .program-grid-frame .ag-grid-scrolling-container')
  const column = grid.getByRole('columnheader', { name: 'Линия', exact: true })
  for (let i = 0; i < 4; i++) {
    await column.locator('.ag-header-cell-text').click()
    await motion.completed(i + 1)
    expect(await retained.evaluate(element => element.isConnected)).toBe(true)
  }
  await column.locator('.ag-header-cell-filter-button').click()
  const filter = page.locator('.ag-filter').filter({ visible: true })
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(page.getByTestId('line-program-card')).toHaveCount(0)
  await motion.completed(5)
  await column.locator('.ag-header-cell-filter-button').click()
  await filter.getByRole('button', { name: 'Сбросить', exact: true }).click()
  await expect(page.getByTestId('line-program-card')).toHaveCount(12)
  await motion.completed(6)
  if (await filter.isVisible()) await filter.press('Escape')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await column.locator('.ag-header-cell-text').click()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect((await motion.read()).length).toBe(6)
})
async function expectReadingOrder(page: Page) {
  await expect.poll(() => page.locator('[data-program-grid]').evaluateAll(roots => {
    const failures: string[] = []
    for (const root of roots) {
      const parents = new Map<Element, number[]>()
      for (const element of root.querySelectorAll('.ag-row[row-index], .ag-cell[aria-colindex], .ag-header-cell[aria-colindex]')) {
        if (element.closest('[data-program-grid]') !== root) continue
        const parent = element.parentElement!, order = parents.get(parent) ?? []
        order.push(Number(element.getAttribute(element.classList.contains('ag-row') ? 'row-index' : 'aria-colindex')))
        parents.set(parent, order)
      }
      for (const order of parents.values()) if (order.some((index, i) => i > 0 && index < order[i - 1])) failures.push(order.join(','))
    }
    return failures
  })).toEqual([])
}
type Sample = { time: number; height: number; rowHeight: number }
async function motionFrames(page: Page, toggle: Locator, detailSelector: string) {
  await page.evaluate(selector => {
    const state = window as typeof window & { motionSamples?: Promise<Sample[]> }
    state.motionSamples = new Promise(resolve => {
      document.addEventListener('click', () => {
        const start = performance.now(), samples: Sample[] = []
        const sample = () => {
          const detail = document.querySelector(selector), shell = detail?.closest('.program-detail-motion')
          samples.push({ time: performance.now() - start, height: shell?.getBoundingClientRect().height ?? 0, rowHeight: detail?.closest('.ag-full-width-row')?.getBoundingClientRect().height ?? 0 })
          if (performance.now() - start < 450) requestAnimationFrame(sample)
          else resolve(samples)
        }
        sample()
      }, { capture: true, once: true })
    })
  }, detailSelector)
  await toggle.click()
  return page.evaluate(() => (window as typeof window & { motionSamples: Promise<Sample[]> }).motionSamples)
}
function expectMotion(samples: Sample[], direction: 'open' | 'close') {
  const maximum = Math.max(...samples.map(sample => sample.height))
  const intermediate = samples.filter(sample => sample.height > 2 && sample.height < maximum - 2)
  expect(intermediate.length).toBeGreaterThanOrEqual(4)
  const changes = samples.slice(1).map((sample, i) => sample.height - samples[i].height)
  expect(changes.every(change => direction === 'open' ? change >= -2 : change <= 2)).toBe(true)
  expect(Math.max(...changes.map(Math.abs))).toBeLessThan(maximum * 0.65)
  // The actual row follows the reveal: a smooth inner clip alone would leave
  // the same abrupt jump in the surrounding table that the user reported.
  const rowIntermediate = samples.filter(sample => sample.rowHeight > 2 && sample.rowHeight < maximum - 2)
  expect(rowIntermediate.length).toBeGreaterThanOrEqual(4)
  const intervals = samples.slice(1).map((sample, i) => sample.time - samples[i].time).sort((a, b) => a - b)
  console.log(JSON.stringify({ disclosure: direction, frames: intermediate.length, frameP95: intervals[Math.floor(intervals.length * 0.95)], maximumHeight: maximum }))
}

test('line, stamp and history reveal and collapse through intermediate heights; reversal and reduced motion', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const line = page.getByRole('button', { name: 'Расчёт линии MOTION-01', exact: true })
  const detail = page.getByTestId('line-program-detail').filter({ has: page.getByRole('heading', { name: 'MOTION-01', exact: true }) })
  await line.click(); await expect(detail.getByRole('button', { name: 'Клеймо MOTION-A', exact: true })).toBeVisible(); await settle(page)
  expectMotion(await motionFrames(page, line, '[data-testid="line-program-detail"][data-line="MOTION-01"]'), 'close')
  await expect(detail).not.toBeVisible()
  expectMotion(await motionFrames(page, line, '[data-testid="line-program-detail"][data-line="MOTION-01"]'), 'open')
  const stamp = detail.getByRole('button', { name: 'Клеймо MOTION-A', exact: true })
  const stampSelector = '[data-testid="stamp-joints-container"][data-stamp="MOTION-A"]'
  await stamp.click(); await expect(detail.getByTestId('line-program-readonly-joint')).toHaveCount(5); await settle(page)
  expectMotion(await motionFrames(page, stamp, stampSelector), 'close')
  expectMotion(await motionFrames(page, stamp, stampSelector), 'open')
  const joint = detail.getByRole('button', { name: 'F1', exact: true })
  await joint.click(); await settle(page)
  expectMotion(await motionFrames(page, joint, '.program-joint-history'), 'close')
  expectMotion(await motionFrames(page, joint, '.program-joint-history'), 'open')
  // Reverse while closing without waiting for its animation or double-clicking.
  await line.click(); await line.click({ force: true })
  await settle(page); await expect(line).toHaveAttribute('aria-expanded', 'true')
  await expect(detail.getByRole('button', { name: 'F1', exact: true })).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await line.click(); await expect(detail).not.toBeVisible(); await settle(page)
  await line.click(); await expect(detail).toBeVisible(); await settle(page)
  expect(errors).toEqual([])
})

test('cached lines reopen repeatedly with independent stamps, histories and filtered tabs', async ({ page }) => {
  const details = page.getByTestId('line-program-detail')
  const line = page.getByRole('button', { name: 'Расчёт линии MOTION-02', exact: true })
  const detail = details.filter({ has: page.getByRole('heading', { name: 'MOTION-02', exact: true }) })
  const neighbor = page.getByRole('button', { name: 'Расчёт линии MOTION-03', exact: true })
  await neighbor.click()
  await line.click()
  await detail.getByRole('button', { name: 'Клеймо MOTION-A', exact: true }).click()
  await detail.getByRole('button', { name: 'F1', exact: true }).click()
  await settle(page)
  const history = detail.locator('.program-joint-history')
  for (let cycle = 0; cycle < 3; cycle++) {
    await line.click(); await settle(page)
    await expect(detail).not.toBeVisible()
    await line.click(); await settle(page)
    await expect(line).toHaveAttribute('aria-expanded', 'true')
    // Visibility alone accepts a 1px clipped shell. Check its real usable area.
    await expect.poll(() => detail.evaluate(element => {
      const shell = element.closest<HTMLElement>('.program-detail-motion')!
      return !shell.inert && shell.getBoundingClientRect().height >= element.getBoundingClientRect().height
    })).toBe(true)
    await expect(history).toBeVisible()
    await expect(neighbor).toHaveAttribute('aria-expanded', 'true')
  }
  await detail.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  const all = detail.getByTestId('line-program-all-joints')
  await all.getByRole('columnheader', { name: 'Стык', exact: true }).locator('.ag-header-cell-filter-button').click()
  const filter = page.locator('.ag-filter').filter({ visible: true })
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('checkbox', { name: 'F2', exact: true }).check()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(all.getByTestId('line-program-readonly-joint')).toHaveCount(1)
  await line.click(); await settle(page); await line.click(); await settle(page)
  await expect(all.getByTestId('line-program-readonly-joint')).toHaveCount(1)
  await expect(all.getByRole('button', { name: 'F2', exact: true })).toBeVisible()
  await detail.getByRole('button', { name: 'По клеймам', exact: true }).click()
  await expect(history).toBeVisible()
})

async function expectHeaderHandover(page: Page, grid: Locator, parentKind: string, rowCount = 5) {
  await expect(grid).toHaveAttribute('data-program-row-count', String(rowCount))
  // Position the reader at the measured tail, not the temporary empty grid
  // before its first rows and the enclosing detail have completed layout.
  let previousGeometry = ''
  await expect.poll(async () => {
    const geometry = await grid.evaluate(element => JSON.stringify([element.getBoundingClientRect().height, element.closest('.ag-full-width-row')?.getBoundingClientRect().height, document.documentElement.scrollHeight]))
    const stable = geometry === previousGeometry; previousGeometry = geometry; return stable
  }).toBe(true)
  for (const offset of [2, -2, 2, -2]) {
    const before = await grid.evaluate((element, offset) => {
      const header = element.querySelector('.ag-grid-pinned-top-rows')!
      const before = { top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, height: element.getBoundingClientRect().height, header: header.getBoundingClientRect().height, page: window.scrollY }
      window.scrollBy(0, element.getBoundingClientRect().bottom - (36 + header.getBoundingClientRect().height + offset))
      return before
    }, offset)
    const expectedKind = offset > 0 ? 'joints' : parentKind
    try {
      await expect.poll(() => page.locator('.program-stuck-control').evaluateAll(elements => elements.filter(element => !!element.getClientRects().length).map(element => element.closest<HTMLElement>('[data-program-grid]')?.dataset.programGrid))).toEqual([expectedKind])
    } catch (error) {
      console.log(JSON.stringify({ handover: { parentKind, offset, before, after: await grid.evaluate(element => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, height: element.getBoundingClientRect().height, header: element.querySelector('.ag-grid-pinned-top-rows')!.getBoundingClientRect().height, page: window.scrollY })) } }))
      throw error
    }
    // Late AG row measurement must not anchor the document to pagination and
    // move the page away from the reading position we just selected.
    await expect.poll(() => grid.evaluate((element, offset) => Math.abs(element.getBoundingClientRect().bottom - (36 + element.querySelector('.ag-grid-pinned-top-rows')!.getBoundingClientRect().height + offset)), offset)).toBeLessThan(1)
    await expect(page.locator('.program-sticky-context')).toHaveJSProperty('hidden', expectedKind === 'lines')
  }
}

test('repeated cached disclosure keeps intermediate frames after twenty cycles', async ({ page }, testInfo) => {
  const toggle = page.getByRole('button', { name: 'Расчёт линии MOTION-02', exact: true })
  const selector = '[data-testid="line-program-detail"][data-line="MOTION-02"]'
  const detail = page.locator(selector)
  await toggle.click()
  await detail.getByRole('button', { name: 'Клеймо MOTION-A', exact: true }).click()
  await detail.getByRole('button', { name: 'F1', exact: true }).click()
  await settle(page)
  const retainedGrids = await detail.locator('.ag-root').elementHandles()
  const observations: { cycle: number; direction: string; intermediate: number; rowIntermediate: number; maximum: number; gap: number }[] = []
  for (let cycle = 0; cycle < 20; cycle++) {
    for (const direction of ['close', 'open'] as const) {
      const samples = await motionFrames(page, toggle, selector)
      const maximum = Math.max(...samples.map(sample => sample.height))
      observations.push({ cycle, direction, maximum, intermediate: samples.filter(sample => sample.height > 2 && sample.height < maximum - 2).length,
        rowIntermediate: samples.filter(sample => sample.rowHeight > 2 && sample.rowHeight < maximum - 2).length,
        gap: Math.max(...samples.slice(1).map((sample, i) => sample.time - samples[i].time)) })
    }
  }
  await writeFile(testInfo.outputPath('disclosure-frames.json'), JSON.stringify(observations, null, 2))
  console.log(JSON.stringify({ workflow: 'twenty repeated disclosure cycles', observations }))
  expect(await Promise.all(retainedGrids.map(element => element.evaluate(node => node.isConnected)))).toEqual(retainedGrids.map(() => true))
  expect(observations.filter(item => item.intermediate < 4 || item.rowIntermediate < 4)).toEqual([])
  await expect(detail.getByRole('button', { name: 'F1', exact: true })).toBeVisible()
  await expectReadingOrder(page)
})

test('cached detail DOM order survives sorting, filtering and replacement; keyboard focus stays usable', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const toggle = page.getByRole('button', { name: 'Расчёт линии MOTION-02', exact: true })
  const detail = page.locator('[data-testid="line-program-detail"][data-line="MOTION-02"]')
  await toggle.click()
  const stamp = detail.getByRole('button', { name: 'Клеймо MOTION-A', exact: true })
  await stamp.click(); await settle(page)
  for (let i = 0; i < 3; i++) {
    await toggle.click(); await settle(page)
    await toggle.click(); await settle(page)
  }
  await expectReadingOrder(page)
  await stamp.focus(); await stamp.press('Enter'); await settle(page)
  await expect(stamp).toBeFocused()
  await stamp.press('Enter'); await settle(page)
  await expect(stamp).toBeFocused()
  const lineColumn = page.locator('[data-program-grid="lines"]').getByRole('columnheader', { name: 'Линия', exact: true })
  await lineColumn.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
  await expect(page.getByTestId('line-program-card').first()).toHaveAttribute('data-line', 'MOTION-12')
  await expectReadingOrder(page)
  await page.getByLabel('Поиск программы линий').fill('MOTION-01')
  await expect(page.getByTestId('line-program-card')).toHaveCount(1)
  await expectReadingOrder(page)
  await page.getByLabel('Поиск программы линий').fill('MOTION-')
  await expect(page.getByTestId('line-program-card')).toHaveCount(12)
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await expect(detail).toBeVisible(); await settle(page)
  await expectReadingOrder(page)
  expect(errors).toEqual([])
})

test('header handover at detail tail has no empty strip, including hidden tabs and empty filtered lists', async ({ page }) => {
  await page.getByRole('button', { name: 'Расчёт линии MOTION-01', exact: true }).click()
  const detail = page.getByTestId('line-program-detail')
  await detail.getByRole('button', { name: 'Клеймо MOTION-A', exact: true }).click(); await settle(page)
  const stampGrid = detail.locator('[data-testid="stamp-joints-container"][data-stamp="MOTION-A"] [data-program-grid="joints"]')
  await expectHeaderHandover(page, stampGrid, 'stamps')
  await detail.getByRole('button', { name: 'Все стыки линии', exact: true }).click(); await settle(page)
  const allGrid = detail.locator('[data-testid="line-program-all-joints"] [data-program-grid="joints"]')
  await expectHeaderHandover(page, allGrid, 'lines')
  // Keep the overview until the incoming columns arrive; the line heading
  // itself must not create an interval with no pinned header.
  await detail.evaluate(element => window.scrollBy(0, element.getBoundingClientRect().top - 70))
  await expect.poll(() => page.locator('.program-stuck-control').evaluateAll(elements =>
    elements.map(element => element.closest<HTMLElement>('[data-program-grid]')?.dataset.programGrid))).toEqual(['lines'])
  await allGrid.getByRole('columnheader', { name: 'Стык', exact: true }).locator('.ag-header-cell-filter-button').click()
  const filter = page.locator('.ag-filter').filter({ visible: true })
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(allGrid.getByTestId('line-program-readonly-joint')).toHaveCount(0)
  await expectHeaderHandover(page, allGrid, 'lines', 0)
})

test('both quota bars track column width beyond the previous 160px cap and shrink back', async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 1000 })
  const overview = page.locator('[data-program-grid="lines"]')
  for (const key of ['common', 'pvk']) {
    const column = overview.locator(`.ag-header-cell[col-id="${key}"]`)
    const bar = page.getByTestId('line-program-card').first().locator(`.ag-cell[col-id="${key}"] [role="progressbar"]`)
    const resizeTo = async (width: number) => {
      const bounds = (await column.boundingBox())!, handle = (await column.locator('.ag-header-cell-resize').boundingBox())!
      const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2
      await page.mouse.move(x, y); await page.mouse.down()
      await page.mouse.move(x + width - bounds.width, y, { steps: 10 }); await page.mouse.up()
      await expect.poll(async () => (await bar.boundingBox())!.width).toBeGreaterThan(width - 45)
    }
    await resizeTo(380)
    const large = (await bar.boundingBox())!.width
    await resizeTo(220)
    expect(large - (await bar.boundingBox())!.width).toBeGreaterThan(150)
    await resizeTo(140)
    expect((await bar.boundingBox())!.width).toBeLessThan(140)
  }
})
