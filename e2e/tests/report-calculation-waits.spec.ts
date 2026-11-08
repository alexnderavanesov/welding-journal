import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createOpeningRecorder } from '../deep-report-opening-probe'
import { seedSmoothnessFixture, cleanupSmoothnessFixture } from '../smoothness-fixture'
import { withLineProgramFixture } from '../line-program-fixtures'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'

// Bounded diagnostics; never part of ordinary functional acceptance.
test.skip(process.env.REPORT_WAIT_MEASUREMENTS !== '1', 'Opt-in local calculation measurements')
test.use({ trace: 'off', video: 'off' })
test('separates a required full calculation from ready report reads', async ({ browser }, info) => {
  test.setTimeout(240000)
  const samples: object[] = []
  try {
    await seedSmoothnessFixture()
    for (let round = 0; round < 3; round++) {
      if (round) await withLineProgramFixture(async () => {})
      for (const [route, report] of [['journal', 'weldingJournal'], ['lnk', 'lnk'], ['psto', 'heatTreatment']] as const) {
        const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } })
        try {
          const page = await context.newPage(), root = `[data-weld-report-grid="${report}"]`
          const target = { name: route, path: `/${route}`, root, frame: `${root} .journal-grid-frame`, leaf: '.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading)', footer: '[data-journal-footer]' }
          const recorder = await createOpeningRecorder(page, target)
          await auditSqlCount()
          const before = await auditSqlDetails()
          try {
            const sample = await recorder.measure(route === 'journal' ? 'required-full-calculation' : 'ready-calculation', round,
              () => page.goto(target.path), async () => {
                await expect(page.locator(`${root} ${target.leaf}`).first()).toBeVisible({ timeout: 90000 })
                await expect(page.locator(target.frame)).toHaveAttribute('aria-busy', 'false')
              }, async () => {
                await expect(page.locator(root).getByText(/^Найдено:\s*[\d\s]+$/, { exact: true })).toBeVisible()
                await expect(page.locator(root).getByText(/^(Подсчёт…|Загрузка…)$/, { exact: true })).toHaveCount(0)
              })
            await auditSqlCount()
            const after = await auditSqlDetails()
            const calculations = after?.dispatcherCalculations.slice(before?.dispatcherCalculations.length ?? 0) ?? []
            expect(calculations).toHaveLength(route === 'journal' ? 1 : 0)
            samples.push({ ...sample, calculations, sqlStatements: before && after ? after.statements - before.statements : null })
            expect(recorder.errors).toEqual([])
          } finally { await recorder.dispose() }
        } finally { await context.close() }
      }
    }
  } finally {
    await writeFile(info.outputPath('calculation-waits.json'), JSON.stringify({ browser: browser.browserType().name(), version: browser.version(), samples }, null, 2))
    await cleanupSmoothnessFixture()
  }
})
