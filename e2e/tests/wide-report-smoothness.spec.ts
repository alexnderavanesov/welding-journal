import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createSmoothnessProbe } from '../smoothness-probe'
import { seedSmoothnessFixture, cleanupSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'
import { withLineProgramFixture } from '../line-program-fixtures'

const enabled = process.env.WIDE_REPORT_MEASUREMENTS === '1'
test.skip(!enabled, 'Explicit local comparison of wide report tables')
test.use({ trace: 'off', video: 'off' })
test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(180000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  await seedSmoothnessFixture()
  // Service dates are normally nullable; the wide-view scenario needs real
  // visible timestamps in every report, identically in both comparison builds.
  await withLineProgramFixture(db => db.query(`update weld_joints set
    created_at='2026-10-31T21:01:02Z', welding_updated_at='2026-11-02T09:10:11Z',
    lnk_created_at='2026-10-31T21:01:02Z', lnk_updated_at='2026-11-02T09:10:11Z',
    psto_created_at='2026-10-31T21:01:02Z', psto_updated_at='2026-11-02T09:10:11Z'
    where project_title=$1`, [SMOOTHNESS_PROJECT]))
})
test.afterAll(async () => { if (enabled) { test.setTimeout(180000); await cleanupSmoothnessFixture() } })

async function openWideReport(page: Page, route: string) {
  await page.addInitScript(() => {
    for (const report of ['weldingJournal', 'lnk', 'heatTreatment']) {
      localStorage.setItem(`welding-report-view:v1:${report}`, JSON.stringify({
        activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
      }))
    }
  })
  await page.goto(`/${route}`)
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(SMOOTHNESS_PROJECT)
  const grid = page.locator('.journal-grid-frame')
  await expect(page.getByText('Найдено: 5000', { exact: true })).toBeVisible({ timeout: 60000 })
  await expect(grid).toHaveAttribute('aria-busy', 'false')
  await page.waitForLoadState('networkidle')
  return grid
}

async function expandThreeLevels(page: Page) {
  const grid = page.locator('.journal-grid-frame')
  for (const column of ['line', 'projectTitle', 'subtitleCode']) {
    await grid.locator(`.ag-header-cell[col-id="${column}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
  }
  await grid.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
  await expect(grid.locator('.ag-row:not(.ag-row-group) .ag-cell[col-id="joint"]').first()).toHaveText(/^(?:F|ОП)\d+/)
  await expect(grid).toHaveAttribute('aria-busy', 'false')
  await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
}

test('wide reports: native scrolling and resizing with flat rows and three expanded levels', async ({ page }, info) => {
  test.setTimeout(600000)
  const probe = await createSmoothnessProbe(page, info), surfaces: object[] = []
  try {
    for (const route of ['journal', 'lnk', 'psto']) {
      const grid = await openWideReport(page, route)
      for (const grouped of [false, true]) {
        if (grouped) await expandThreeLevels(page)
        const geometry = await grid.evaluate(element => {
          const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')!
          return { columnCount: Number(element.querySelector('[aria-colcount]')?.getAttribute('aria-colcount')),
            scrollWidth: viewport.scrollWidth, clientWidth: viewport.clientWidth,
            rows: element.querySelectorAll('.ag-row').length, cells: element.querySelectorAll('.ag-cell').length }
        })
        // PSTO has its own smaller field set (65 columns in the current full
        // view); it must not inherit the journal's 118-column expectation.
        expect(geometry.columnCount).toBeGreaterThan(60)
        expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth * 5)
        surfaces.push({ route, grouped, ...geometry })
        for (let round = 0; round < 3; round++) {
          const label = `${route}:${grouped ? 'grouped' : 'flat'}`
          await probe.scroll(`${label}:vertical:${round}`, grid)
          await probe.scroll(`${label}:horizontal:${round}`, grid, true)
          await probe.resize(`${label}:resize:${round}`, grid, 'line')
        }
      }
    }
  } finally {
    await writeFile(info.outputPath('surfaces.json'), JSON.stringify(surfaces, null, 2))
    await probe.finish()
  }
})

const timestampFields = {
  journal: ['createdAt', 'weldingUpdatedAt'],
  lnk: ['lnkCreatedAt', 'lnkUpdatedAt'],
  psto: ['pstoCreatedAt', 'pstoUpdatedAt'],
} as const

async function showTimestampColumns(page: Page, route: keyof typeof timestampFields) {
  const grid = page.locator('.journal-grid-frame'), viewport = grid.locator('.ag-grid-viewport')
  const fields = timestampFields[route]
  const header = grid.locator(`.ag-header-cell[col-id="${fields[0]}"]`)
  await viewport.evaluate(element => { element.scrollLeft = 0 })
  for (let step = 0; step < 60 && !await header.count(); step++) {
    await viewport.evaluate(element => { element.scrollLeft += 500 })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  }
  await header.scrollIntoViewIfNeeded()
  await expect(grid.locator(`.ag-row:not(.ag-row-group) [col-id="${fields[0]}"]`).first()).toHaveText('01.11.26 00:01')
  await expect(grid.locator(`.ag-row:not(.ag-row-group) [col-id="${fields[1]}"]`).first()).toHaveText('02.11.26 12:10')
  await page.waitForLoadState('networkidle')
  return viewport
}

async function timestampSweep(page: Page, probe: Awaited<ReturnType<typeof createSmoothnessProbe>>, route: keyof typeof timestampFields, label: string) {
  const grid = page.locator('.journal-grid-frame'), viewport = grid.locator('.ag-grid-viewport')
  const start = await viewport.evaluate(element => element.scrollLeft)
  expect(start).toBeGreaterThan(1600)
  const box = (await viewport.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(100, box.height / 2))
  const movement = { start, midpoint: 0, end: 0, timestampColumnsRemoved: false }
  await probe.measure(label, async () => {
    for (const direction of [-1, 1]) {
      for (let step = 0; step < 16; step++) {
        await page.mouse.wheel(direction * 100, 0)
        await page.waitForTimeout(16)
      }
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const position = await viewport.evaluate(element => element.scrollLeft)
      if (direction === -1) {
        movement.midpoint = position
        await expect(grid.locator(`.ag-row:not(.ag-row-group) [col-id="${timestampFields[route][0]}"]`)).toHaveCount(0)
        movement.timestampColumnsRemoved = true
      } else movement.end = position
    }
  }, movement)
  expect(movement.midpoint).toBe(start - 1600)
  expect(movement.end).toBe(start)
  await expect(grid.locator(`.ag-row:not(.ag-row-group) [col-id="${timestampFields[route][0]}"]`).first()).toHaveText('01.11.26 00:01')
}

test('timestamp reports: far columns leave virtualization and return with correct values', async ({ page }, info) => {
  test.setTimeout(600000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    for (const route of ['journal', 'lnk', 'psto'] as const) {
      const grid = await openWideReport(page, route)
      for (const grouped of [false, true]) {
        if (grouped) {
          await grid.locator('.ag-grid-viewport').evaluate(element => { element.scrollLeft = 0 })
          await expandThreeLevels(page)
        }
        await showTimestampColumns(page, route)
        const label = `${route}:${grouped ? 'grouped' : 'flat'}:timestamps`
        await timestampSweep(page, probe, route, `${label}:warmup`)
        for (let round = 0; round < 3; round++) {
          await timestampSweep(page, probe, route, `${label}:horizontal:${round}`)
          await probe.scroll(`${label}:vertical:${round}`, grid)
          await probe.resize(`${label}:resize:${round}`, grid, 'line')
        }
      }
    }
  } finally { await probe.finish() }
})

test('diagnostic: sampled CPU of grouped timestamp column gestures', async ({ page, browser }, info) => {
  test.skip(process.env.WIDE_REPORT_CPU_PROFILE !== '1' || browser.browserType().name() !== 'chromium', 'Separate diagnostic, excluded from comparison samples')
  test.setTimeout(180000)
  const probe = await createSmoothnessProbe(page, info)
  const cdp = await page.context().newCDPSession(page)
  try {
    const grid = await openWideReport(page, 'journal')
    await expandThreeLevels(page)
    await showTimestampColumns(page, 'journal')
    await probe.scroll('warmup:vertical', grid)
    await timestampSweep(page, probe, 'journal', 'warmup:horizontal')
    await cdp.send('Profiler.enable')
    for (const action of ['vertical', 'horizontal', 'resize']) {
      await cdp.send('Profiler.start')
      try {
        if (action === 'resize') await probe.resize('profile:resize', grid, 'line')
        else if (action === 'horizontal') await timestampSweep(page, probe, 'journal', 'profile:horizontal')
        else await probe.scroll('profile:vertical', grid)
      } finally {
        const { profile } = await cdp.send('Profiler.stop')
        await writeFile(info.outputPath(`${action}.cpuprofile`), JSON.stringify(profile))
      }
    }
  } finally { await cdp.detach(); await probe.finish() }
})

test('paired diagnostic: date formatter reuse on the same page and horizontal gesture', async ({ page }, info) => {
  test.skip(process.env.WIDE_REPORT_PAIRED !== '1', 'Separate controlled diagnostic on the baseline bundle')
  test.setTimeout(180000)
  await page.addInitScript(() => {
    const Original = Intl.DateTimeFormat
    const state = { cached: false, constructors: 0, formats: new Map<string, Intl.DateTimeFormat>() }
    Object.assign(window, { wideDateComparison: state })
    Intl.DateTimeFormat = new Proxy(Original, {
      construct(target, args, newTarget) {
        const [locale, options] = args
        // Limit the diagnostic to the two exact service-date formats. Other
        // application/browser date formatters retain their ordinary behavior.
        const seconds = options?.second === '2-digit'
        const matches = locale === 'ru-RU' && options?.timeZone === 'Europe/Moscow'
          && ['year', 'month', 'day', 'hour', 'minute'].every(key => options[key] === '2-digit')
          && options.hourCycle === 'h23' && Object.keys(options).length === (seconds ? 8 : 7)
        if (!matches) return Reflect.construct(target, args, newTarget)
        const key = seconds ? 'seconds' : 'minutes'
        if (state.cached && state.formats.has(key)) return state.formats.get(key)!
        state.constructors++
        const formatter = Reflect.construct(target, args, newTarget) as Intl.DateTimeFormat
        if (state.cached) state.formats.set(key, formatter)
        return formatter
      },
    })
  })
  const probe = await createSmoothnessProbe(page, info), counts: object[] = []
  const mode = (cached: boolean) => page.evaluate(cached => {
    const state = (window as unknown as { wideDateComparison: { cached: boolean; constructors: number } }).wideDateComparison
    state.cached = cached; state.constructors = 0
  }, cached)
  try {
    await openWideReport(page, 'journal')
    await showTimestampColumns(page, 'journal')
    for (const cached of [false, true]) {
      await mode(cached)
      await timestampSweep(page, probe, 'journal', `paired:warmup:${cached}`)
    }
    for (const [round, cached] of [false, true, true, false, false, true].entries()) {
      await mode(cached)
      await timestampSweep(page, probe, 'journal', `paired:${cached ? 'reuse' : 'fresh'}:${round}`)
      const constructors = await page.evaluate(() =>
        (window as unknown as { wideDateComparison: { constructors: number } }).wideDateComparison.constructors)
      counts.push({ round, cached, constructors })
      if (cached) expect(constructors).toBe(0)
      else expect(constructors).toBeGreaterThan(0)
    }
  } finally {
    await writeFile(info.outputPath('paired-constructors.json'), JSON.stringify(counts, null, 2))
    await probe.finish()
  }
})
