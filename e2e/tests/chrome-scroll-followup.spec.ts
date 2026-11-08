import { expect as playwrightExpect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { seedAgGridScaleFixture, AG_GRID_SCALE_PROJECT } from '../ag-grid-scale-fixture'
import { createSmoothnessProbe } from '../smoothness-probe'

// Local, opt-in diagnostics. CSS experiments are injected only into the test
// page, never the application bundle. Every sample is retained, including cold
// gestures and background account activity; traced runs are diagnostic only.
test.skip(!process.env.CHROME_SCROLL_FOLLOWUP, 'Explicit Chrome follow-up only')
test.use({ trace: 'off', video: 'off', actionTimeout: 30000 })
// Large server groups use the same readiness allowance as the existing 250k
// comparison. A default 5s assertion can stop before the first leaf arrives.
const expect = playwrightExpect.configure({ timeout: 60000 })

test('Chrome PSTO and document settings scroll attribution', async ({ page, browser }, info) => {
  test.setTimeout(1200000)
  const consoleIssues: string[] = []
  page.on('console', message => {
    if (message.type() === 'error' || (message.type() === 'warning' && /AG Grid/.test(message.text()))) consoleIssues.push(message.text())
  })
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(info.project.use.channel).toBe('chrome')
  const mode = process.env.CHROME_SCROLL_FOLLOWUP
  expect(['settings', 'psto', 'plain-control']).toContain(mode)
  const rounds = Number(process.env.CHROME_SCROLL_ROUNDS ?? '6')
  expect(Number.isInteger(rounds) && rounds > 0 && rounds <= 40).toBe(true)
  const experiment = process.env.CHROME_SCROLL_EXPERIMENT ?? 'baseline'
  expect(['baseline', 'opaque-navigation', 'local-scroll-distance']).toContain(experiment)
  const phases = process.env.CHROME_SCROLL_SERIES === 'distance'
    ? ['baseline', 'local-scroll-distance', 'local-scroll-distance', 'baseline']
    : process.env.CHROME_SCROLL_SERIES === 'views' ? ['flat', 'grouped'] : [experiment]
  const count = Number(process.env.CHROME_SCROLL_ROWS ?? '250000')
  if (count !== 50000 && count !== 250000) throw new Error('Use the verified 50k or 250k fixture')
  const grouped = process.env.CHROME_SCROLL_GROUPED === '1'
  const preparation: object[] = [], motion: object[] = []
  if (mode === 'psto') {
    console.log('FOLLOWUP_SEED_START')
    await seedAgGridScaleFixture(count)
    console.log('FOLLOWUP_SEED_COMPLETE')
    await page.addInitScript(() => localStorage.setItem('welding-report-view:v1:heatTreatment', JSON.stringify({
      activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
    })))
  }
  const openPage = async (expandGroups = grouped) => {
    if (mode === 'psto') {
    await page.goto('/psto')
    const root = page.locator('[data-weld-report-grid="heatTreatment"]')
    const frame = root.locator('.journal-grid-frame')
    await expect(frame.locator('.ag-row[row-id]:not(.ag-row-loading)').first()).toBeVisible({ timeout: 240000 })
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(AG_GRID_SCALE_PROJECT)
    await expect(root.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible({ timeout: 240000 })
    await expect(frame).toHaveAttribute('aria-busy', 'false', { timeout: 240000 })
    if (expandGroups) {
      for (const column of ['projectTitle', 'subtitleCode', 'line']) {
        await frame.locator(`.ag-header-cell[col-id="${column}"]`).click({ button: 'right' })
        await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
      }
      await frame.locator('.ag-row-group .ag-cell[col-id="projectTitle"]').first().click({ button: 'right' })
      await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
      await expect(frame.locator('.ag-row:not(.ag-row-group) .ag-cell[col-id="joint"]').first()).toHaveText(/^(?:F|ОП)\d+/)
      await expect(frame).toHaveAttribute('aria-busy', 'false', { timeout: 240000 })
    }
    await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }))
    await expect(frame.locator('.ag-row-loading')).toHaveCount(0)
    await page.waitForLoadState('networkidle')
  } else if (mode === 'plain-control') {
    // Same Chrome input driver and 98px page range as the settings observation,
    // with no application scripts, framework, blur, or scroll handlers.
    await page.goto('data:text/html,<style>body{margin:0}main{height:1098px;background:linear-gradient(white,lightblue)}</style><main>Scroll control</main>')
  } else {
    await page.goto('/settings')
    await page.getByRole('main').getByRole('button', { name: 'Документы', exact: true }).click()
    }
  }
  await openPage()
  const surface = mode === 'psto' ? page.locator('.journal-grid-frame') : page.getByRole('main')
  const probe = await createSmoothnessProbe(page, info)
  try {
    for (const [phase, variant] of phases.entries()) {
      if (phase) await openPage(variant === 'grouped' || grouped)
      if (variant === 'opaque-navigation') {
        expect(mode).toBe('settings')
        await page.addStyleTag({ content: '[data-settings-navigation] { backdrop-filter: none !important; background: white !important; }' })
      }
      if (variant === 'local-scroll-distance') {
        expect(mode).toBe('psto')
        await page.addStyleTag({ content: '@property --journal-scroll-distance { syntax: "<length>"; inherits: false; initial-value: 0px; }' })
      }
      if (mode === 'psto' && phases.length > 1) {
        for (const top of [0, 1600, 0]) {
          await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), top)
          await page.waitForLoadState('networkidle')
          const read = () => surface.evaluate(element => {
            const body = element.querySelector<HTMLElement>('[data-journal-native-scroll]')!
            const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')!
            return { top: scrollY, viewportTop: viewport.scrollTop,
              bodyY: new DOMMatrixReadOnly(getComputedStyle(body).transform).m42,
              distance: getComputedStyle(body).getPropertyValue('--journal-scroll-distance'),
              childDistance: getComputedStyle(body.firstElementChild!).getPropertyValue('--journal-scroll-distance') }
          })
          // Check transform/viewport coherence only. Both can still be zero
          // before the scroll event is handled, so these diagnostic snapshots
          // do not establish that the requested target has settled. Compare
          // measured wheel outcomes separately; the grid contract tests assert
          // visible row movement and selection across native document scroll.
          await expect.poll(async () => { const value = await read(); return Math.abs(value.bodyY + value.viewportTop) }).toBeLessThan(1)
          motion.push({ variant, phase, ...await read() })
        }
      }
    for (let n = 0; n < rounds; n++) {
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }) })
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
      preparation.push(await surface.evaluate(element => ({
        range: document.scrollingElement!.scrollHeight - innerHeight,
        rect: element.getBoundingClientRect().toJSON(),
        rows: element.querySelectorAll('.ag-row').length,
        cells: element.querySelectorAll('.ag-cell').length,
      })))
      console.log('FOLLOWUP_SCROLL', mode, variant, phase, n)
      await probe.scroll(phases.length === 1 ? `${mode}:${n}` : `${mode}:${variant}:${phase}:${n}`, surface)
    }
    }
  } finally {
    await probe.finish()
    await writeFile(info.outputPath('followup.json'), JSON.stringify({ mode, experiment, phases, rounds, count, grouped,
      version: browser.version(), build: process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', consoleIssues, preparation, motion }, null, 2))
  }
  const result = JSON.parse(await readFile(info.outputPath('smoothness.json'), 'utf8'))
  expect(result.errors).toEqual([])
  expect(consoleIssues).toEqual([])
  expect(result.samples).toHaveLength(rounds * phases.length)
  for (const sample of result.samples) {
    expect(sample.interaction.outcome).toBe('scrolled')
    expect(sample.interaction.start).toBe(0)
    expect(sample.interaction.end).toBe(0)
    expect(sample.interaction.amplitude).toBe(mode === 'psto' ? 1600 : 98)
    expect(sample.requests.filter((request: { name: string }) => request.name !== 'refreshAccountActivity_createServerFn_handler')).toEqual([])
  }
  if (process.env.CHROME_FACET_READY_MEASUREMENTS === '1') {
    expect(mode).toBe('psto')
    const errors: string[] = [], samples: { query: string; readyMs: number }[] = []
    page.on('pageerror', error => errors.push(error.message))
    await surface.locator('.ag-header-cell[col-id="joint"] .ag-header-cell-filter-button').click()
    const dialog = page.getByRole('dialog', { name: 'Фильтр: Стык', exact: true })
    await expect(dialog.getByRole('checkbox').first()).toBeVisible()
    try {
      for (let round = 0; round < 5; round++) for (const query of ['000000000001', String(count).padStart(12, '0')]) {
        const started = performance.now()
        await dialog.getByLabel('Найти значение фильтра').fill(query)
        // Observe the matching result itself: expect's retry cadence must not
        // turn crossing its polling boundary into an apparent 500 ms slowdown.
        await expect.poll(async () => ({
          count: await dialog.getByRole('checkbox').count(),
          matching: await dialog.getByRole('checkbox', { name: new RegExp(query) }).count(),
        }), { intervals: [16] }).toEqual({ count: 1, matching: 1 })
        const readyMs = performance.now() - started
        samples.push({ query, readyMs })
      }
      await dialog.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
      expect(errors).toEqual([])
    } finally {
      await writeFile(info.outputPath('facet-readiness.json'), JSON.stringify({ count, pollingIntervalMs: 16, samples, errors }, null, 2))
    }
  }
})
