import { expect, test } from '@playwright/test'
import { createSmoothnessProbe } from '../smoothness-probe'
import { seedSmoothnessFixture, cleanupSmoothnessFixture } from '../smoothness-fixture'

test.skip(!process.env.SMOOTHNESS_LABEL, 'Explicit isolated performance comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 10000 })

test('repeat performance outliers: guide readiness, document scrolling and welder units', async ({ page }, info) => {
  test.setTimeout(300000)
  await seedSmoothnessFixture()
  const probe = await createSmoothnessProbe(page, info)
  try {
    for (let round = 0; round < 5; round++) {
      await probe.measure(`recheck:guide:${round}`, async () => {
        if (round === 0) await page.goto('/account?tab=guide')
        else await page.reload()
        // Both waitFor and ordinary assertions back off to 500 ms polling.
        // Explicit short polling keeps that delay out of this timing recheck.
        await expect.poll(() => page.getByRole('heading', { name: 'Как работать в системе', exact: true }).isVisible(), {
          intervals: [16],
        }).toBe(true)
      })
    }
    await page.goto('/documents')
    const documents = page.locator('[data-document-history-grid]')
    for (const name of ['ЖСР', 'Заявка ЛНК']) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(documents.locator('.ag-row').first()).toBeVisible()
      await page.waitForLoadState('networkidle')
      for (let round = 0; round < 5; round++) await probe.scroll(`recheck:documents:${name}:${round}`, documents)
    }
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Сварщики', exact: true }).click()
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
    await expect(page.locator('[data-statistics-grid="welders"] .ag-row').first()).toBeVisible()
    for (let round = 0; round < 5; round++) {
      for (const unit of ['WDI', 'Стыки']) {
        await probe.measure(`recheck:welder-unit:${unit}:${round}`, async () => {
          await page.getByRole('button', { name: unit, exact: true }).click()
          await expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled()
        })
      }
    }
  } finally {
    await probe.finish()
    await page.close()
    await cleanupSmoothnessFixture()
  }
})
