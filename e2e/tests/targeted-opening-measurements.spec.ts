import { expect, test, type Page } from '@playwright/test'
import { writeFile, copyFile } from 'node:fs/promises'
import { createOpeningRecorder, type OpeningSurface } from '../deep-report-opening-probe'
import { seedSmoothnessFixture, cleanupSmoothnessFixture } from '../smoothness-fixture'
import { auditSqlDetails, auditSqlCount } from '../audit-sql'
import { createSmoothnessProbe } from '../smoothness-probe'

// Explicit bounded investigation, not a latency assertion or the full audit.
const enabled = process.env.TARGETED_OPENING_MEASUREMENTS === '1'
test.skip(!enabled, 'Opt-in local production measurements')
test.use({ trace: 'off', video: 'off' })
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
  await expect(root.locator(target.leaf).first()).toBeVisible({ timeout: 90000 })
  if (['journal', 'lnk', 'psto'].includes(report.name)) await expect(frame).toHaveAttribute('aria-busy', 'false', { timeout: 90000 })
  await expect(frame).not.toHaveAttribute('data-journal-updating', '')
  await expect(root.locator('.ag-row-loading')).toHaveCount(0)
}
async function complete(page: Page, report: Report) {
  if (report.name === 'program') {
    await ready(page, report)
    // Retained rows can appear before the new visit's authoritative section.
    // Keep first-row timing separate from complete, fresh section readiness.
    await expect(page.getByTestId('line-program').getByRole('status')).toHaveCount(0)
    return
  }
  await expect(page.locator(report.root).getByText(/^Найдено:\s*[\d\s]+$/, { exact: true })).toBeVisible({ timeout: 90000 })
  await expect(page.locator(report.root).getByText(/^(Подсчёт…|Загрузка…)$/, { exact: true })).toHaveCount(0)
}
test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(180000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  await seedSmoothnessFixture()
})
test.afterAll(async () => { if (enabled) { test.setTimeout(180000); await cleanupSmoothnessFixture() } })

test('five sections: separate dirty index, cold browser, refresh and actual SPA returns', async ({ browser }, info) => {
  test.setTimeout(900000)
  const results: object[] = []
  const contextOptions = { storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } }
  const save = () => writeFile(info.outputPath('targeted-opening.json'), JSON.stringify({ browser: browser.browserType().name(),
    version: browser.version(), viewport: contextOptions.viewport, fixture: { joints: 5000, lines: 50, stamps: 1000, documents: 700 }, results }, null, 2))
  const runContext = async (report: Report, cold: number, prime = false) => {
    const context = await browser.newContext(contextOptions)
    try {
      const page = await context.newPage()
      page.setDefaultTimeout(30000)
      const recorder = await createOpeningRecorder(page, surface(report))
      const measure = async (phase: string, round: number, action: () => Promise<unknown>) => {
        // Flush earlier navigation's telemetry outside the timed action.
        await auditSqlCount()
        const before = await auditSqlDetails()
        const sample = await recorder.measure(phase, round, action, () => ready(page, report), () => complete(page, report))
        await auditSqlCount()
        const after = await auditSqlDetails()
        const reads = Object.fromEntries(Object.entries(after?.resources?.reads ?? {}).map(([table, value]) => [table, {
          calls: value.calls - (before?.resources?.reads[table]?.calls ?? 0),
          rows: value.rows - (before?.resources?.reads[table]?.rows ?? 0),
          milliseconds: value.totalMilliseconds - (before?.resources?.reads[table]?.totalMilliseconds ?? 0),
        }] as const).filter(([, value]) => value.calls > 0))
        results.push({ ...sample, sqlStatements: before && after ? after.statements - before.statements : null, reads })
        await save()
        expect(recorder.errors).toEqual([])
      }
      try {
        await measure(prime ? 'dirty-index-first-opening' : 'cold-browser-context', cold, () => page.goto(report.path))
        if (prime || cold !== 2) return
        for (let round = 0; round < 3; round++) await measure('warm-reload', round, () => page.reload())
        for (let round = 0; round < 5; round++) {
          const away = report.name === 'journal' ? reports[1] : reports[0]
          await page.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: away.button, exact: true }).click()
          await ready(page, away); await complete(page, away); await page.waitForLoadState('networkidle')
          await measure('warm-spa-return', round, () => page.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: report.button, exact: true }).click())
        }
        expect(recorder.errors).toEqual([])
      } finally { await recorder.dispose() }
    } finally { await context.close() }
  }
  try {
    await runContext(reports[0], 0, true)
    const selected = process.env.TARGETED_OPENING_SURFACES?.split(',')
    const measured = selected ? reports.filter(report => selected.includes(report.name)) : reports
    expect(measured.length).toBeGreaterThan(0)
    for (const report of measured) for (let cold = 0; cold < 3; cold++) await runContext(report, cold)
  } finally {
    await save()
    if (process.env.AUDIT_SQL_COUNTS_FILE) await copyFile(process.env.AUDIT_SQL_COUNTS_FILE, info.outputPath('sql-and-resources.json'))
  }
})

test('documents: registry scrolling and resizing in three general types', async ({ page }, info) => {
  test.setTimeout(180000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/documents')
    for (const label of ['ЖСР', 'Чек-лист', 'ЗНИ']) {
      await page.getByRole('button', { name: label, exact: true }).click()
      const grid = page.locator('[data-document-history-grid]')
      await expect(grid.locator('.ag-row').first()).toBeVisible()
      await expect(grid.getByText('Найдено: 100', { exact: true })).toBeVisible()
      await page.waitForLoadState('networkidle')
      for (let round = 0; round < 3; round++) {
        await probe.scroll(`documents:${label}:vertical:${round}`, grid)
        await probe.resize(`documents:${label}:resize:${round}`, grid)
      }
    }
  } finally { await probe.finish() }
})

test('diagnostic CPU profile of a cold journal browser with prepared server data', async ({ browser, page }, info) => {
  test.skip(process.env.TARGETED_CPU_PROFILE !== '1' || browser.browserType().name() !== 'chromium', 'Separate diagnostic, excluded from normal latency samples')
  test.setTimeout(120000)
  await page.goto('/journal'); await ready(page, reports[0]); await page.waitForLoadState('networkidle')
  const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } })
  try {
    const cold = await context.newPage(), cdp = await context.newCDPSession(cold)
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.start')
    await cold.goto('/journal'); await ready(cold, reports[0]); await complete(cold, reports[0])
    const { profile } = await cdp.send('Profiler.stop')
    await writeFile(info.outputPath('cold-journal.cpuprofile'), JSON.stringify(profile))
    await cdp.detach()
  } finally { await context.close() }
})
