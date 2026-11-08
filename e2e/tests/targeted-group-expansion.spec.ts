import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createOpeningRecorder, installOpeningProbe } from '../deep-report-opening-probe'
import { seedSmoothnessFixture, cleanupSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'
import { auditSqlCount } from '../audit-sql'

// Diagnostic only: separate earlier grouping requests and menu opening from
// the actual "Expand all" command. Application code remains unchanged.
test.skip(process.env.TARGETED_OPENING_MEASUREMENTS !== '1', 'Opt-in local measurements')
test.use({ trace: 'off', video: 'off' })
test('three reports: repeated isolated expansion of all groups', async ({ browser }, info) => {
  test.setTimeout(300000)
  const samples: object[] = []
  try {
    await seedSmoothnessFixture()
    for (const [route, report] of [['journal', 'weldingJournal'], ['lnk', 'lnk'], ['psto', 'heatTreatment']] as const) {
      for (let round = 0; round < 3; round++) {
        const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } })
        try {
          const page = await context.newPage()
          await page.goto(`/${route}`)
          await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(SMOOTHNESS_PROJECT)
          await expect(page.getByText('Найдено: 5000', { exact: true })).toBeVisible({ timeout: 60000 })
          const root = `[data-weld-report-grid="${report}"]`, grid = page.locator(`${root} .journal-grid-frame`)
          for (const column of ['line', 'projectTitle', 'subtitleCode']) {
            await grid.locator(`.ag-header-cell[col-id="${column}"]`).click({ button: 'right' })
            await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
            await expect(grid).toHaveAttribute('aria-busy', 'false')
            await page.waitForLoadState('networkidle')
          }
          await grid.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
          const command = page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true })
          await expect(command).toBeVisible()
          const target = { name: route, path: `/${route}`, root, frame: `${root} .journal-grid-frame`, leaf: '.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading)', footer: '[data-journal-footer]' }
          const recorder = await createOpeningRecorder(page, target)
          await page.evaluate(installOpeningProbe, target)
          const before = await auditSqlCount()
          try {
            const sample = await recorder.measure('expand-all-prepared-groups', round, () => command.click(), async () => {
              await expect(grid.locator('.ag-row:not(.ag-row-group) .ag-cell[col-id="joint"]').first()).toHaveText(/^(?:F|ОП)\d+/)
              await expect(grid).toHaveAttribute('aria-busy', 'false')
            }, async () => {})
            const after = await auditSqlCount()
            samples.push({ ...sample, sqlStatements: before !== undefined && after !== undefined ? after - before : null })
            expect(recorder.errors).toEqual([])
          } finally { await recorder.dispose() }
        } finally { await context.close() }
      }
    }
  } finally {
    await writeFile(info.outputPath('group-expansion.json'), JSON.stringify({ browser: browser.browserType().name(), version: browser.version(), samples }, null, 2))
    await cleanupSmoothnessFixture()
  }
})
