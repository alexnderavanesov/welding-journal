import { expect as playwrightExpect, test, type Page, type Locator } from '@playwright/test'
import { writeFile, copyFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { seedAgGridScaleFixture, readAgGridScaleCalculationSignature, AG_GRID_SCALE_PROJECT } from '../ag-grid-scale-fixture'
import { createOpeningRecorder, type OpeningSurface } from '../deep-report-opening-probe'
import { createSmoothnessProbe } from '../smoothness-probe'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'
import { sampleLocalAuditResources } from '../audit-resources'
import { withE2eDatabase } from '../database'
import { openDocumentGridFilter, openDocumentGridColumnMenu } from '../document-grid'

const count = Number(process.env.AG_GRID_SCALE_ROWS)
const expect = playwrightExpect.configure({ timeout: 60000 })
const enabled = [50000, 250000].includes(count)
test.skip(!enabled, 'Explicit isolated 50k / 250k Chrome comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 30000 })
const reports = [
  { name: 'journal', path: '/journal', button: 'Сварочный журнал', root: '[data-weld-report-grid="weldingJournal"]' },
  { name: 'lnk', path: '/lnk', button: 'ЛНК', root: '[data-weld-report-grid="lnk"]' },
  { name: 'psto', path: '/psto', button: 'ПСТО и ТВМТ', root: '[data-weld-report-grid="heatTreatment"]' },
  { name: 'documents', path: '/documents', button: 'Документы', root: '[data-document-history-grid="generated:weldingJournal"]' },
  { name: 'program', path: '/line-program', button: 'Программа линий', root: '[data-program-grid="lines"]' },
] as const
type Report = typeof reports[number]
function surface(report: Report): OpeningSurface {
  return { ...report, frame: report.name === 'program' ? report.root : `${report.root} .journal-grid-frame`,
    leaf: report.name === 'program' ? '.ag-row[row-id]:not(.ag-row-loading)' : '.ag-row[row-id]:not(.ag-row-loading):not(.ag-row-group)',
    footer: report.name === 'documents' ? '.document-grid-footer' : '[data-journal-footer]' }
}
async function ready(page: Page, report: Report) {
  const target = surface(report), root = page.locator(target.root), frame = page.locator(target.frame)
  await expect(page).toHaveURL(new RegExp(`${report.path}(?:\\?|$)`))
  await expect(root.locator(target.leaf).first()).toBeVisible({ timeout: 240000 })
  if (['journal', 'lnk', 'psto'].includes(report.name)) await expect(frame).toHaveAttribute('aria-busy', 'false', { timeout: 240000 })
  await expect(frame).not.toHaveAttribute('data-journal-updating', '')
  await expect(root.locator('.ag-row-loading')).toHaveCount(0)
}
async function complete(page: Page, report: Report) {
  if (report.name === 'program') {
    await ready(page, report)
    await expect(page.getByTestId('line-program').getByRole('status')).toHaveCount(0, { timeout: 240000 })
    await expect(page.getByTestId('line-program').getByRole('alert')).toHaveCount(0)
  } else {
    await expect(page.locator(report.root).getByText(/^Найдено:\s*[\d\s]+$/, { exact: true })).toBeVisible({ timeout: 240000 })
    await expect(page.locator(report.root).getByText(/^(Подсчёт…|Загрузка…)$/, { exact: true })).toHaveCount(0, { timeout: 240000 })
  }
}
async function total(root: Locator, expected: number) {
  await expect(root.getByText(`Найдено: ${expected}`, { exact: true })).toBeVisible({ timeout: 240000 })
}
async function idle(page: Page, grid: Locator) {
  await expect(grid.locator('.ag-row-loading')).toHaveCount(0, { timeout: 240000 })
  await expect(grid).not.toHaveAttribute('data-journal-updating', '', { timeout: 240000 })
  if (await grid.getAttribute('aria-busy') !== null) await expect(grid).toHaveAttribute('aria-busy', 'false', { timeout: 240000 })
}

test('five sections at the exact scale: openings, groups, full facets and native gestures', async ({ browser }, info) => {
  test.setTimeout(3600000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  const label = process.env.AG_GRID_SCALE_LABEL ?? `${count}`
  const onlyPhase = process.env.AG_GRID_SCALE_PHASE
  if (onlyPhase && !['interactions', 'interactions:program-nested'].includes(onlyPhase)) throw new Error('Unsupported isolated supplemental phase')
  if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Unsafe scale output label')
  const destination = resolve('outputs/ag-grid-scale-2026-11-07', label)
  await mkdir(destination, { recursive: true })
  console.log(`SCALE_SEED_START ${count}`)
  const seedStarted = performance.now(), fixture = await seedAgGridScaleFixture(count as 50000 | 250000)
  console.log(`SCALE_SEED_COMPLETE ${count} ${Math.round(performance.now() - seedStarted)}ms`)
  await writeFile(resolve(destination, 'fixture.json'), JSON.stringify(fixture, null, 2))
  const results: object[] = [], surfaces: object[] = [], failures: { name: string; message: string }[] = []
  let interactionPage: Page | undefined
  const options = { storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } }
  const save = () => writeFile(resolve(destination, 'opening.json'), JSON.stringify({ label, browser: browser.browserType().name(), version: browser.version(),
    viewport: options.viewport, count, onlyPhase, results, surfaces, failures }, null, 2))
  const resources = browser.browserType().name() === 'chromium' ? await sampleLocalAuditResources(browser) : null
  const runOpening = async (report: Report, cold: number, dirty = false) => {
    const context = await browser.newContext(options)
    try {
      const page = await context.newPage(); page.setDefaultTimeout(240000)
      const recorder = await createOpeningRecorder(page, surface(report))
      const measure = async (phase: string, round: number, action: () => Promise<unknown>) => {
        await auditSqlCount()
        const before = await auditSqlDetails()
        const sample = await recorder.measure(phase, round, action, () => ready(page, report), () => complete(page, report))
        await auditSqlCount()
        const after = await auditSqlDetails()
        const reads = Object.fromEntries(Object.entries(after?.resources?.reads ?? {}).map(([table, value]) => [table, {
          calls: value.calls - (before?.resources?.reads[table]?.calls ?? 0), rows: value.rows - (before?.resources?.reads[table]?.rows ?? 0),
          milliseconds: value.totalMilliseconds - (before?.resources?.reads[table]?.totalMilliseconds ?? 0),
        }] as const).filter(([, value]) => value.calls > 0))
        results.push({ section: report.name, ...sample, sqlStatements: before && after ? after.statements - before.statements : null, reads })
        await save(); expect(recorder.errors).toEqual([])
      }
      try {
        await measure(dirty ? 'dirty-index-first-opening' : 'cold-browser-context', cold, () => page.goto(report.path))
        if (dirty || cold !== 2) return
        for (let round = 0; round < 3; round++) await measure('warm-reload', round, () => page.reload())
        for (let round = 0; round < 3; round++) {
          const away = report.name === 'journal' ? reports[1] : reports[0]
          await page.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: away.button, exact: true }).click()
          await ready(page, away); await complete(page, away); await page.waitForLoadState('networkidle')
          await measure('warm-spa-return', round, () => page.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: report.button, exact: true }).click())
        }
      } finally { await recorder.dispose() }
    } finally { await context.close() }
  }
  const section = async (name: string, run: () => Promise<unknown>) => {
    if (onlyPhase && name !== onlyPhase && !(onlyPhase === 'interactions' && name.startsWith('interactions:'))) return
    console.log(`SCALE_PHASE_START ${name}`)
    try { await run(); await resources?.checkpoint(name); console.log(`SCALE_PHASE_COMPLETE ${name}`) }
    catch (error) {
      failures.push({ name, message: String(error) }); console.log(`SCALE_PHASE_FAILED ${name} ${error}`)
      if (interactionPage && !interactionPage.isClosed()) {
        await interactionPage.screenshot({ path: resolve(destination, `${name.replaceAll(':', '-')}-failure.png`), timeout: 5000 }).catch(() => {})
      }
    }
    await save()
  }
  try {
    if (onlyPhase !== 'interactions:program-nested') await runOpening(reports[0], 0, true)
    for (const report of reports) await section(`opening:${report.name}`, async () => {
      for (let cold = 0; cold < 3; cold++) await runOpening(report, cold)
    })
    // Validate the actual PostgreSQL publication outside every timed sample.
    if (onlyPhase !== 'interactions:program-nested') {
      const signature = await readAgGridScaleCalculationSignature()
      await writeFile(resolve(destination, 'calculation-signature.json'), JSON.stringify(signature, null, 2))
      expect(signature.joints).toBe(count)
      expect(signature.pageCount).toBeGreaterThan(0)
      expect(signature.declaredTaskCount).toBe(signature.actualTaskCount)
      expect(signature.invalidTaskIdentityCount).toBe(0)
      expect(signature.pageCountMismatchCount).toBe(0)
      expect(signature.pageSequenceErrorCount).toBe(0)
    }
    // Fresh context prevents earlier navigation/view state from altering the
    // wide-table and grouping comparisons. SQL comes from the exact frozen build.
    const context = await browser.newContext(options)
    const page = await context.newPage(); page.setDefaultTimeout(60000)
    interactionPage = page
    const probe = await createSmoothnessProbe(page, info)
    try {
      await page.addInitScript(() => {
        for (const report of ['weldingJournal', 'lnk', 'heatTreatment']) localStorage.setItem(`welding-report-view:v1:${report}`, JSON.stringify({
          activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
        }))
      })
      const gestures = async (name: string, grid: Locator, column?: string, horizontal = true) => {
        const geometry = await grid.evaluate(element => {
          const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')
          return { columns: Number(element.querySelector('[aria-colcount]')?.getAttribute('aria-colcount')),
            scrollWidth: viewport?.scrollWidth ?? 0, clientWidth: viewport?.clientWidth ?? 0,
            renderedRows: element.querySelectorAll('.ag-row').length, renderedCells: element.querySelectorAll('.ag-cell').length }
        })
        surfaces.push({ name, ...geometry })
        if (/^(journal|lnk|psto):/.test(name)) {
          // Full PSTO has 57 columns after the eight retired stamp fields.
          expect(geometry.columns).toBeGreaterThanOrEqual(name.startsWith('psto:') ? 57 : 100)
          expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth * 5)
        }
        for (let round = 0; round < 3; round++) {
          await probe.scroll(`${name}:vertical:${round}`, grid)
          if (horizontal) await probe.scroll(`${name}:horizontal:${round}`, grid, true)
          await probe.resize(`${name}:resize:${round}`, grid, column)
        }
      }
      const queries = await withE2eDatabase(async db => {
        const q = ['000000000001', String(count).padStart(12, '0'), '00000002']
        const expected: { match: string; count: number }[] = []
        for (const match of q) expected.push({ match, count: Number((await db.query(
          'select count(*) from weld_joints where project_title=$1 and position($2 in joint)>0', [AG_GRID_SCALE_PROJECT, match])).rows[0].count) })
        return expected
      })
      expect(queries[0].count).toBe(1); expect(queries[1].count).toBe(1); expect(queries[2].count).toBeGreaterThan(150)
      await writeFile(resolve(destination, 'filter-expectations.json'), JSON.stringify(queries, null, 2))
      for (const report of reports.slice(0, 3)) await section(`interactions:${report.name}`, async () => {
        await page.goto(report.path)
        await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(AG_GRID_SCALE_PROJECT)
        const root = page.locator(report.root), grid = root.locator('.journal-grid-frame')
        await total(root, count); await idle(page, grid)
        await probe.measure(`${report.name}:facet:first`, async () => {
          await grid.locator('.ag-header-cell[col-id="joint"] .ag-header-cell-filter-button').click()
          await expect(page.getByRole('dialog', { name: 'Фильтр: Стык', exact: true }).getByRole('checkbox').first()).toBeVisible()
        })
        const dialog = page.getByRole('dialog', { name: 'Фильтр: Стык', exact: true }), search = dialog.getByLabel('Найти значение фильтра')
        for (const query of queries) await probe.measure(`${report.name}:facet:search:${query.match}`, async () => {
          await search.fill(query.match)
          await expect(dialog.getByRole('checkbox')).toHaveCount(Math.min(150, query.count))
          if (query.count === 1) await expect(dialog.getByRole('checkbox')).toHaveAccessibleName(new RegExp(query.match))
          await idle(page, grid)
        })
        await probe.measure(`${report.name}:facet:select-all-found`, async () => {
          await dialog.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
          await total(root, queries[2].count); await idle(page, grid)
        })
        await dialog.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click(); await total(root, count)
        await search.fill(''); await expect(dialog.getByRole('checkbox')).toHaveCount(150)
        await probe.measure(`${report.name}:facet:next-page`, async () => {
          await dialog.getByRole('button', { name: /Ещё значения/ }).click()
          await expect(dialog.getByRole('checkbox')).toHaveCount(300)
        })
        // Baseline has a separately reproduced More -> focus loss -> Escape
        // defect. Use the explicit close control for comparable scroll samples;
        // keyboard closure is covered by the focused regression after the fix.
        await dialog.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click(); await expect(dialog).toBeHidden()
        await gestures(`${report.name}:flat`, grid, 'line')
        await probe.measure(`${report.name}:group-project-subtitle-line`, async () => {
          for (const column of ['projectTitle', 'subtitleCode', 'line']) {
            await grid.locator(`.ag-header-cell[col-id="${column}"]`).click({ button: 'right' })
            await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
          }
          await grid.locator('.ag-row-group .ag-cell[col-id="projectTitle"]').first().click({ button: 'right' })
          await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
          await expect(grid.locator('.ag-row:not(.ag-row-group) .ag-cell[col-id="joint"]').first()).toHaveText(/^(?:F|ОП)\d+/)
          await total(root, count); await idle(page, grid)
        })
        await gestures(`${report.name}:grouped`, grid, 'line')
        await page.screenshot({ path: resolve(destination, `${report.name}-grouped.png`) })
      })
      await section('interactions:program', async () => {
        await page.goto('/line-program'); await complete(page, reports[4])
        await gestures('program:overview', page.locator('[data-program-grid="lines"]'), 'line')
        await probe.measure('program:overview-grouping', async () => {
          const overview = page.locator('[data-program-grid="lines"]')
          await overview.getByRole('columnheader', { name: 'Соединений', exact: true }).click({ button: 'right' })
          await page.getByRole('menuitem', { name: 'Группировать по «Соединений»', exact: true }).click()
          await overview.getByRole('columnheader', { name: 'Линия', exact: true }).click({ button: 'right' })
          await page.getByRole('menuitem', { name: 'Развернуть все', exact: true }).click()
          await expect(overview.locator('.ag-row-group').first()).toBeVisible()
        })
        await gestures('program:overview-grouped', page.locator('[data-program-grid="lines"]'), 'line')
        await page.getByRole('button', { name: 'Убрать группировку Соединений', exact: true }).click()
        await probe.measure('program:heavy-line', async () => {
          await page.getByLabel('Поиск программы линий', { exact: true }).fill(fixture.heavyLine)
          await page.getByRole('button', { name: `Расчёт линии ${fixture.heavyLine}`, exact: true }).click()
          await expect(page.locator('[data-program-grid="stamps"] .ag-row').first()).toBeVisible()
          await idle(page, page.locator('[data-program-grid="stamps"]'))
        })
        await gestures('program:stamps', page.locator('[data-program-grid="stamps"]'), undefined, false)
      })
      await section('interactions:program-heavy-joints', async () => {
        await page.goto('/line-program'); await complete(page, reports[4])
        await page.getByLabel('Поиск программы линий', { exact: true }).fill(fixture.heavyLine)
        await page.getByRole('button', { name: `Расчёт линии ${fixture.heavyLine}`, exact: true }).click()
        await probe.measure('program:10000-line-joints', async () => {
          await page.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
          await expect(page.getByTestId('line-program-all-joints').locator('[data-program-grid="joints"]')).toHaveAttribute('data-program-row-count', '8000')
        })
        const joints = page.getByTestId('line-program-all-joints').locator('[data-program-grid="joints"]')
        await gestures('program:all-joints', joints, 'joint')
        await page.screenshot({ path: resolve(destination, 'program-all-joints.png') })
        await probe.measure('program:joint-filter', async () => {
          await joints.locator('.ag-header-cell[col-id="joint"] .ag-header-cell-filter-button').click()
          const filter = page.locator('.ag-filter').filter({ visible: true })
          await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
          await filter.getByRole('textbox').fill('F000000000001')
          await filter.getByRole('checkbox', { name: 'F000000000001', exact: true }).check()
          await filter.getByRole('button', { name: 'Применить', exact: true }).click()
          await expect(joints.locator('.ag-row')).toHaveCount(1)
        })
        await probe.measure('program:assignments-open', async () => {
          await page.getByRole('button', { name: 'Назначения линии', exact: true }).click()
          await expect(page.locator('[data-program-grid="assignments"] .ag-row').first()).toBeVisible()
        })
        await gestures('program:assignments', page.locator('[data-program-grid="assignments"]'), 'joint')
        await page.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
      })
      await section('interactions:program-nested', async () => {
        for (const branches of [1, 10]) {
          await page.goto('/line-program')
          await page.getByLabel('Поиск программы линий', { exact: true }).fill(fixture.denseLine)
          await page.getByRole('button', { name: `Расчёт линии ${fixture.denseLine}`, exact: true }).click()
          for (const stamp of fixture.denseStamps.slice(0, branches)) {
            console.log(`SCALE_PROGRAM_EXPAND ${branches} ${stamp}`)
            const disclosure = page.getByRole('button', { name: `Клеймо ${stamp}`, exact: true })
            // Visibility alone includes an off-screen retained master. Scrolling
            // it into view implicitly can detach that virtual row mid-click.
            // Reach the remaining masters through the document, as a reader does.
            if (stamp !== fixture.denseStamps[0]) await expect(async () => {
              await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
              await expect(disclosure).toBeInViewport({ timeout: 500 })
            }).toPass({ timeout: 30000 })
            else await expect(disclosure).toBeVisible()
            await disclosure.click()
            await expect(page.locator(`[data-testid="stamp-joints-container"][data-stamp="${stamp}"] [data-program-grid="joints"]`)).toHaveAttribute('data-program-row-count', '320')
            await expect(page.locator('.program-detail-motion[data-program-motion]')).toHaveCount(0)
          }
          await expect(page.locator('[data-program-grid="joints"]:visible')).toHaveCount(branches)
          await idle(page, page.locator('[data-program-grid="lines"]'))
          console.log(`SCALE_PROGRAM_GESTURES ${branches}`)
          await gestures(`program:${branches}-branches`, page.locator(`[data-testid="stamp-joints-container"][data-stamp="${fixture.denseStamps[0]}"] [data-program-grid="joints"]`), 'joint', false)
          if (branches === 10) await page.screenshot({ path: resolve(destination, 'program-ten-branches.png') })
        }
      })
      await section('interactions:program-supports', async () => {
        await page.goto('/line-program')
        await probe.measure('program:supports-open', async () => {
          await page.getByRole('button', { name: 'Опоры', exact: true }).click()
          await complete(page, reports[4])
        })
        await probe.measure('program:supports-line', async () => {
          await page.getByLabel('Поиск программы линий', { exact: true }).fill(fixture.heavyLine)
          await page.getByRole('button', { name: `Расчёт линии ${fixture.heavyLine}`, exact: true }).click()
          await page.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
          await expect(page.getByTestId('line-program-all-joints').locator('[data-program-grid="joints"]')).toHaveAttribute('data-program-row-count', '2000')
        })
      })
      // The heavy line has 500 primary documents per PSTO/TVMT type,
      // plus two repeat cycles grouped in pairs for its first repeat joints.
      const heavyCycleDocuments = 500 + Math.min(count / 20, 10000)
      for (const { label, expectedTotal, field, fieldLabel, match, filteredTotal } of [
        { label: 'ЖСР', expectedTotal: fixture.documentCounts.weldingJournal, field: 'title', fieldLabel: 'Документ', match: fixture.queryValues.documents.jsrLast, filteredTotal: 1 },
        { label: 'Чек-лист', expectedTotal: fixture.documentCounts.checklist, field: 'line', fieldLabel: 'Линия', match: fixture.heavyLine, filteredTotal: 1000 },
        { label: 'ЗНИ', expectedTotal: fixture.documentCounts.zni, field: 'line', fieldLabel: 'Линия', match: fixture.heavyLine, filteredTotal: 1000 },
        { label: 'Заявка ЛНК', expectedTotal: fixture.registryCounts.uiTabs.lnkRequest, field: 'line', fieldLabel: 'Линия', match: fixture.heavyLine, filteredTotal: 6000 },
        { label: 'Заключения ЛНК', expectedTotal: fixture.registryCounts.uiTabs.lnkConclusion, field: 'title', fieldLabel: 'Документ', match: `AGS-VIK-${count / 2}`, filteredTotal: 1 },
        { label: 'Заявка ПСТО', expectedTotal: fixture.documentCounts['system:pstoRequest'], field: 'line', fieldLabel: 'Линия', match: fixture.heavyLine, filteredTotal: heavyCycleDocuments },
        { label: 'Заключение ПСТО', expectedTotal: fixture.documentCounts['system:pstoConclusion'], field: 'line', fieldLabel: 'Линия', match: fixture.heavyLine, filteredTotal: heavyCycleDocuments },
        { label: 'Заявка ТВМТ', expectedTotal: fixture.registryCounts.uiTabs.tvmtRequest, field: 'line', fieldLabel: 'Линия', match: fixture.heavyLine, filteredTotal: heavyCycleDocuments },
        { label: 'Заключение ТВМТ', expectedTotal: fixture.registryCounts.uiTabs.tvmtConclusion, field: 'line', fieldLabel: 'Линия', match: fixture.heavyLine, filteredTotal: heavyCycleDocuments },
      ]) await section(`documents:${label}`, async () => {
        await page.goto('/documents')
        await page.getByRole('button', { name: label, exact: true }).click()
        const grid = page.locator('[data-document-history-grid]')
        await expect(grid.locator('.ag-row').first()).toBeVisible(); await total(grid, expectedTotal); await idle(page, grid.locator('.document-grid-frame'))
        await gestures(`documents:${label}:flat`, grid)
        await probe.measure(`documents:${label}:deep-block`, async () => {
          // Vertical scrolling belongs to the page; an inner scrollTop write
          // races the document-scroll adapter and need not reach a deep block.
          await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
          await expect.poll(async () => {
            const indices = await grid.locator('.ag-row[row-id^="document:"]').evaluateAll(elements => elements.map(element => Number(element.getAttribute('row-index'))))
            return Math.max(...indices)
          }, { timeout: 240000 }).toBe(expectedTotal - 1)
          await idle(page, grid.locator('.document-grid-frame'))
        })
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
        await expect(grid.locator('.ag-row[row-id^="document:"][row-index="0"]')).toBeVisible()
        await idle(page, grid.locator('.document-grid-frame'))
        await probe.measure(`documents:${label}:facet:first`, async () => {
          const dialog = await openDocumentGridFilter(page, field, fieldLabel)
          await expect(dialog.locator('.document-filter-options')).toHaveAttribute('aria-busy', 'false')
          await expect(dialog.getByRole('checkbox').first()).toBeVisible()
        })
        const dialog = page.getByRole('dialog', { name: `Фильтр: ${fieldLabel}`, exact: true })
        await probe.measure(`documents:${label}:facet:search`, async () => {
          await dialog.getByLabel('Найти значение фильтра').fill(match)
          await expect(dialog.locator('.document-filter-options')).toHaveAttribute('aria-busy', 'false')
          await expect(dialog.getByRole('checkbox')).toHaveCount(1)
          await expect(dialog.getByRole('checkbox')).toHaveAccessibleName(new RegExp(match))
        })
        await probe.measure(`documents:${label}:filter`, async () => {
          await dialog.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
          await total(grid, filteredTotal)
          await idle(page, grid.locator('.document-grid-frame'))
        })
        await dialog.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
        await page.keyboard.press('Escape'); await idle(page, grid.locator('.document-grid-frame'))
        await total(grid, expectedTotal)
        await probe.measure(`documents:${label}:groups`, async () => {
          await openDocumentGridColumnMenu(page, 'line')
          await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
          await expect(grid.locator('.ag-row-group').first()).toBeVisible(); await idle(page, grid.locator('.document-grid-frame'))
        })
        await gestures(`documents:${label}:grouped`, grid)
        if (label === 'ЖСР') await page.screenshot({ path: resolve(destination, 'documents-jsr-grouped.png') })
      })
    } finally {
      await probe.finish()
      await copyFile(info.outputPath('smoothness.json'), resolve(destination, 'interactions.json'))
      await context.close()
    }
  } finally {
    await save(); await auditSqlCount()
    if (process.env.AUDIT_SQL_COUNTS_FILE) {
      await copyFile(process.env.AUDIT_SQL_COUNTS_FILE, resolve(destination, 'sql-and-resources.json'))
      await copyFile(resolve(dirname(process.env.AUDIT_SQL_COUNTS_FILE), 'scale-facet-trace.json'), resolve(destination, 'scale-facet-trace.json'))
    }
    if (resources) {
      const result = await resources(); await writeFile(resolve(destination, 'resources.json'), JSON.stringify(result, null, 2))
      expect(result.errors).toEqual([])
    }
  }
  expect(failures).toEqual([])
})
