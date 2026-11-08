import { expect as playwrightExpect, test, type Locator, type Page, type Request } from '@playwright/test'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { seedAgGridScaleFixture, AG_GRID_SCALE_PROJECT } from '../ag-grid-scale-fixture'
import { createOpeningRecorder, type OpeningSurface } from '../deep-report-opening-probe'
import { createSmoothnessProbe } from '../smoothness-probe'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'
import { rpcName } from '../rpc'

// Run each frozen bundle through e2e/run.ts separately: it owns setup/drop of
// the same fresh isolated 50k fixture. This file records one side, not a verdict.
test.skip(process.env.AG_GRID_SCALE_CONFIRM !== '1', 'Explicit serial 50k confirmation only')
test.use({ trace: 'off', video: 'off', actionTimeout: 30000 })
const expect = playwrightExpect.configure({ timeout: 60000 })
const lnkOnly = process.env.AG_GRID_SCALE_CONFIRM_LNK_ONLY === '1'
const reports = [
  { name: 'journal', path: '/journal', root: '[data-weld-report-grid="weldingJournal"]' },
  { name: 'lnk', path: '/lnk', root: '[data-weld-report-grid="lnk"]' },
  { name: 'psto', path: '/psto', root: '[data-weld-report-grid="heatTreatment"]' },
  { name: 'documents', path: '/documents', root: '[data-document-history-grid="generated:weldingJournal"]' },
  { name: 'program', path: '/line-program', root: '[data-program-grid="lines"]' },
] as const
type Report = typeof reports[number]

function surface(report: Report): OpeningSurface {
  return { ...report, frame: report.name === 'program' ? report.root : `${report.root} .journal-grid-frame`,
    leaf: report.name === 'program' ? '.ag-row[row-id]:not(.ag-row-loading)' : '.ag-row[row-id]:not(.ag-row-loading):not(.ag-row-group)',
    footer: report.name === 'documents' ? '.document-grid-footer' : '[data-journal-footer]' }
}
async function idle(grid: Locator) {
  await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
  await expect(grid).not.toHaveAttribute('data-journal-updating', '')
  if (await grid.getAttribute('aria-busy') !== null) await expect(grid).toHaveAttribute('aria-busy', 'false')
}
async function rowsReady(page: Page, report: Report) {
  const target = surface(report)
  await expect(page).toHaveURL(new RegExp(`${report.path}(?:\\?|$)`))
  await expect(page.locator(target.root).locator(target.leaf).first()).toBeVisible({ timeout: 240000 })
  await idle(page.locator(target.frame))
}
async function summaryReady(page: Page, report: Report) {
  if (report.name === 'program') {
    await expect(page.getByTestId('line-program').getByRole('status')).toHaveCount(0)
    await expect(page.getByTestId('line-program').getByRole('alert')).toHaveCount(0)
  } else {
    const root = page.locator(report.root)
    await expect(root.getByText(/^Найдено:\s*[\d\s]+$/, { exact: true })).toBeVisible({ timeout: 240000 })
    await expect(root.getByText(/^(Подсчёт…|Загрузка…)$/, { exact: true })).toHaveCount(0)
  }
}

// Keep the shared probes unchanged. These local events add response/body finish
// timing for the heavy-line action, where the smoothness probe records starts.
function requestLifecycle(page: Page) {
  type Call = { name: string; start: number; response?: number; finish?: number; status?: number; failure?: string; timing?: ReturnType<Request['timing']> }
  const calls: Call[] = [], active = new Map<Request, Call>()
  page.on('request', request => {
    const name = rpcName(request.url())
    if (name) { const call = { name, start: performance.now() }; active.set(request, call); calls.push(call) }
  })
  page.on('response', response => {
    const call = active.get(response.request())
    if (call) { call.response = performance.now(); call.status = response.status() }
  })
  const finish = (request: Request) => {
    const call = active.get(request)
    if (call) {
      call.finish = performance.now(); call.failure = request.failure()?.errorText
      call.timing = request.timing(); active.delete(request)
    }
  }
  page.on('requestfinished', finish); page.on('requestfailed', finish)
  return () => {
    const from = calls.length, started = performance.now()
    return () => calls.slice(from).map(call => ({ name: call.name, startMs: call.start - started,
      responseMs: call.response === undefined ? null : call.response - started,
      finishMs: call.finish === undefined ? null : call.finish - started,
      durationMs: call.finish === undefined ? null : call.finish - call.start,
      status: call.status, failure: call.failure, timing: call.timing }))
  }
}

test(lnkOnly ? 'reverse confirmation of 20 vertical LNK gestures on one frozen build'
  : 'confirm four flat axes, grouped LNK, cold LNK and heavy-line stamps on one frozen build', async ({ browser }, info) => {
  test.setTimeout(1200000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.AG_GRID_SCALE_ROWS).toBe('50000')
  expect(process.env.E2E_CHROME).toBe('1')
  expect(info.project.use.channel).toBe('chrome')
  expect(browser.browserType().name()).toBe('chromium')
  expect(info.config.workers).toBe(1)
  const label = process.env.AG_GRID_SCALE_LABEL
  const allowedLabels = lnkOnly ? ['lnk-reverse-new', 'lnk-reverse-old'] : ['confirmation-before', 'confirmation-after']
  if (!label || !allowedLabels.includes(label)) throw new Error(`Use one of: ${allowedLabels.join(', ')}`)
  if (!process.env.E2E_AUDIT_OUTPUT_DIR) throw new Error('Select the frozen baseline / candidate build explicitly')
  const build = resolve(process.env.E2E_AUDIT_OUTPUT_DIR)
  if (build === resolve('.output')) throw new Error('Use a frozen build, not mutable .output')
  if (lnkOnly) expect(build).toBe(resolve('outputs/ag-grid-scale-2026-11-07', label === 'lnk-reverse-new' ? 'candidate-build' : 'baseline-build'))
  await access(resolve(build, 'server/index.mjs'))
  const destination = resolve('outputs/ag-grid-scale-2026-11-07', label)
  // Refuse to replace earlier evidence or resume into an already warmed DB.
  await mkdir(destination)
  const options = { storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } }
  const preparation: object[] = [], openings: object[] = [], program: object[] = [], geometry: object[] = []
  const rounds = { coldLnk: lnkOnly ? 0 : 10, heavyLineStamps: lnkOnly ? 0 : 5, eachScrollAxis: 20, scrollTotal: lnkOnly ? 20 : 100 }
  const metadata = { label, build, count: 50000, profile: lnkOnly ? 'lnk-flat-vertical-only' : 'full-confirmation',
    startedAt: new Date().toISOString(), browser: browser.browserType().name(), version: browser.version(), viewport: options.viewport,
    rounds, cpuThrottling: 'none' }
  const save = () => writeFile(resolve(destination, 'confirmation.json'), JSON.stringify({ ...metadata, preparation, openings, program, geometry }, null, 2))
  try {
    const fixture = await seedAgGridScaleFixture(50000)
    await writeFile(resolve(destination, 'fixture.json'), JSON.stringify(fixture, null, 2))
    // Identical server preparation, excluded from every measured sample: the
    // dirty full calculation, then one ready opening of all five sections.
    const preparationContext = await browser.newContext(options)
    try {
      const page = await preparationContext.newPage(), errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      for (const [index, report] of [reports[0], ...reports].entries()) {
        const started = performance.now()
        await page.goto(report.path); await rowsReady(page, report); await summaryReady(page, report)
        await page.waitForLoadState('networkidle'); await auditSqlCount()
        preparation.push({ section: report.name, phase: index === 0 ? 'dirty-index' : 'ready-opening', elapsedMs: performance.now() - started })
        await save(); expect(errors).toEqual([])
      }
    } finally { await preparationContext.close() }

    for (let round = 0; round < rounds.coldLnk; round++) {
      const context = await browser.newContext(options)
      try {
        const page = await context.newPage(), recorder = await createOpeningRecorder(page, surface(reports[1]))
        try {
          await auditSqlCount(); const before = await auditSqlDetails()
          const sample = await recorder.measure('cold-browser-context', round, () => page.goto('/lnk'),
            () => rowsReady(page, reports[1]), () => summaryReady(page, reports[1]))
          const after = await auditSqlCount()
          openings.push({ ...sample, sqlStatements: before && after !== undefined ? after - before.statements : null })
          await save(); expect(recorder.errors).toEqual([])
        } finally { await recorder.dispose() }
      } finally { await context.close() }
    }

    for (let round = 0; round < rounds.heavyLineStamps; round++) {
      const context = await browser.newContext(options)
      try {
        const page = await context.newPage(), beginRequests = requestLifecycle(page)
        const probe = await createSmoothnessProbe(page, info)
        try {
          await page.goto('/line-program'); await rowsReady(page, reports[4]); await summaryReady(page, reports[4])
          await page.waitForLoadState('networkidle'); await auditSqlCount()
          let requests: ReturnType<ReturnType<typeof requestLifecycle>> = () => []
          let actionReadyMs: number | undefined
          await probe.measure(`program:heavy-line:${round}`, async () => {
            requests = beginRequests(); const started = performance.now()
            await page.getByLabel('Поиск программы линий', { exact: true }).fill(fixture.heavyLine)
            await page.getByRole('button', { name: `Расчёт линии ${fixture.heavyLine}`, exact: true }).click()
            const grid = page.locator('[data-program-grid="stamps"]')
            await expect(grid.locator('.ag-row').first()).toBeVisible(); await idle(grid)
            actionReadyMs = performance.now() - started
          })
          const calls = requests()
          program.push({ round, actionReadyMs, requests: calls })
          await save()
          expect(calls.length).toBeGreaterThan(0)
          expect(calls.every(call => call.finishMs !== null && !call.failure && call.status !== undefined && call.status < 400)).toBe(true)
        } finally {
          await probe.finish()
          await copyFile(info.outputPath('smoothness.json'), resolve(destination, `program-stamps-${round}.json`))
        }
      } finally { await context.close() }
    }

    const context = await browser.newContext(options)
    try {
      const page = await context.newPage()
      await page.addInitScript(() => {
        for (const report of ['weldingJournal', 'lnk', 'heatTreatment']) localStorage.setItem(`welding-report-view:v1:${report}`, JSON.stringify({
          activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
        }))
      })
      const probe = await createSmoothnessProbe(page, info)
      try {
        for (const report of lnkOnly ? [reports[1]] : [reports[0], reports[1], reports[3]]) {
          await page.goto(report.path); await rowsReady(page, report); await summaryReady(page, report)
          const checklist = report.name === 'documents'
          if (checklist) await page.getByRole('button', { name: 'Чек-лист', exact: true }).click()
          else await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(AG_GRID_SCALE_PROJECT)
          const root = page.locator(checklist ? '[data-document-history-grid]' : report.root)
          const frame = root.locator(checklist ? '.document-grid-frame' : '.journal-grid-frame')
          const grid = checklist ? root : frame
          await expect(root.getByText(`Найдено: ${checklist ? fixture.documentCounts.checklist : 50000}`, { exact: true })).toBeVisible()
          await idle(frame); await expect(grid.locator('.ag-row-group')).toHaveCount(0)
          // The one additional grouped profile uses this same 50k fixture;
          // it does not claim to repeat the original 250k grouped samples.
          for (const grouped of report.name === 'lnk' && !lnkOnly ? [false, true] : [false]) {
            if (grouped) {
              for (const column of ['projectTitle', 'subtitleCode', 'line']) {
                await grid.locator(`.ag-header-cell[col-id="${column}"]`).click({ button: 'right' })
                await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
              }
              await grid.locator('.ag-row-group .ag-cell[col-id="projectTitle"]').first().click({ button: 'right' })
              await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
              await expect(grid.locator('.ag-row:not(.ag-row-group) .ag-cell[col-id="joint"]').first()).toHaveText(/^(?:F|ОП)\d+/)
              await expect(root.getByText('Найдено: 50000', { exact: true })).toBeVisible()
              await idle(frame)
            }
            const profile = checklist ? 'documents:Чек-лист:flat' : `${report.name}:${grouped ? 'grouped' : 'flat'}`
            for (let round = 0; round < rounds.eachScrollAxis; round++) for (const horizontal of report.name === 'lnk' && !grouped && !lnkOnly ? [false, true] : [false]) {
              // Reset each axis through its actual owner. Setting the inner
              // viewport's scrollTop would ask the page adapter to navigate
              // again, racing the document offset (261 -> 148 in checklist).
              // The probe independently records owner/start/end/amplitude.
              await grid.evaluate((element, top) => {
                for (const viewport of element.querySelectorAll<HTMLElement>('.ag-grid-viewport')) viewport.scrollLeft = 0
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                window.scrollTo({ top, left: 0, behavior: 'instant' })
              }, checklist ? 261 : 0)
              await idle(frame); await page.waitForLoadState('networkidle'); await auditSqlCount()
              const name = `${profile}:${horizontal ? 'horizontal' : 'vertical'}:${round}`
              const state = await grid.evaluate(element => {
                const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport'), box = element.getBoundingClientRect()
                return { windowX: scrollX, windowY: scrollY, viewportX: viewport?.scrollLeft, viewportY: viewport?.scrollTop,
                  viewportWidth: viewport?.clientWidth, viewportHeight: viewport?.clientHeight, scrollWidth: viewport?.scrollWidth,
                  scrollHeight: document.scrollingElement?.scrollHeight, box: { x: box.x, y: box.y, width: box.width, height: box.height },
                  columns: Number(element.querySelector('[aria-colcount]')?.getAttribute('aria-colcount')),
                  domNodes: document.querySelectorAll('*').length, rows: element.querySelectorAll('.ag-row').length, cells: element.querySelectorAll('.ag-cell').length }
              })
              geometry.push({ name, ...state })
              expect(state.windowY).toBe(checklist ? 261 : 0); expect(state.viewportX).toBe(0)
              if (!checklist) { expect(state.columns).toBeGreaterThan(60); expect(state.scrollWidth!).toBeGreaterThan(state.viewportWidth! * 5) }
              await probe.scroll(name, grid, horizontal); await save()
            }
          }
        }
      } finally {
        await probe.finish()
        await copyFile(info.outputPath('smoothness.json'), resolve(destination, 'interactions.json'))
      }
    } finally { await context.close() }
    const interactionResult = JSON.parse(await readFile(resolve(destination, 'interactions.json'), 'utf8')) as {
      samples: { name: string; domNodes: number; renderedGridRows: number; interaction: { ownerLabel: string; start: number; end: number; amplitude: number; outcome: string; range: number; point: { x: number; y: number } } }[]
    }
    expect(interactionResult.samples).toHaveLength(rounds.scrollTotal)
    const scrollGeometry = new Map<string, { range: number; point: { x: number; y: number }; domNodes: number; renderedGridRows: number }>()
    for (const sample of interactionResult.samples) {
      const horizontal = sample.name.includes(':horizontal:'), checklist = sample.name.startsWith('documents:')
      const profile = sample.name.replace(/:\d+$/, ''), shape = { range: sample.interaction.range, point: sample.interaction.point,
        domNodes: sample.domNodes, renderedGridRows: sample.renderedGridRows }
      if (!scrollGeometry.has(profile)) scrollGeometry.set(profile, shape)
      expect(shape, sample.name).toEqual(scrollGeometry.get(profile))
      expect(sample.interaction.outcome, sample.name).toBe('scrolled')
      expect(sample.interaction.ownerLabel, sample.name).toMatch(horizontal ? /^div\.ag-grid-viewport\.ag-layout-normal(?:\.|$)/ : /^document\.scrollingElement$/)
      expect(sample.interaction.start, sample.name).toBe(checklist ? 261 : 0)
      expect(sample.interaction.end, sample.name).toBe(sample.interaction.start)
      expect(sample.interaction.amplitude, sample.name).toBe(1600)
    }
  } finally {
    await save(); await auditSqlCount()
    if (process.env.AUDIT_SQL_COUNTS_FILE) await copyFile(process.env.AUDIT_SQL_COUNTS_FILE, resolve(destination, 'sql-and-resources.json'))
  }
})
