import { expect, test, type Page } from '@playwright/test'
import { createSmoothnessProbe } from '../smoothness-probe'
import { seedSmoothnessFixture, cleanupSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'

const enabled = !!process.env.SMOOTHNESS_LABEL
test.skip(!enabled, 'Explicit local performance comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 10000 })
test.beforeAll(async () => { if (enabled) { test.setTimeout(180000); await seedSmoothnessFixture() } })
test.afterAll(async () => { if (enabled) { test.setTimeout(180000); await cleanupSmoothnessFixture() } })
async function reportReady(page: Page) {
  await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 60000 })
  await expect(page.locator('.journal-grid-frame .ag-row[row-id]').first()).toBeVisible()
}

test('all sections: first opening, refresh and return, with populated registries', async ({ page }, info) => {
  test.setTimeout(600000)
  const probe = await createSmoothnessProbe(page, info)
  const sections: [string, () => Promise<unknown>][] = [
    ...['journal', 'lnk', 'psto'].map(route => [`/${route}`, () => reportReady(page)] as [string, () => Promise<unknown>]),
    ['/line-program', () => expect(page.locator('[data-program-grid="lines"] .ag-row').first()).toBeVisible({ timeout: 60000 })],
    ['/documents', () => expect(page.locator('[data-document-history-grid] .ag-row').first()).toBeVisible({ timeout: 60000 })],
    ['/statistics', () => expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled({ timeout: 60000 })],
    ['/references', () => expect(page.getByRole('row').filter({ hasText: 'Q000' }).first()).toBeVisible()],
    ['/references?tab=specialists', () => expect(page.getByRole('row').filter({ hasText: 'SM специалист' }).first()).toBeVisible()],
    ['/references?tab=technologyCards', () => expect(page.getByRole('row').filter({ hasText: 'SM-TK-' }).first()).toBeVisible()],
    ['/account?tab=profile', () => expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()],
    ['/account?tab=users', () => expect(page.getByRole('columnheader', { name: /Статус аккаунта/ })).toBeVisible()],
    ['/activity', () => expect(page.getByRole('grid', { name: 'Журнал действий' }).getByRole('row').nth(1)).toBeVisible()],
    ['/account?tab=rules&section=connections', () => expect(page.getByRole('treegrid').getByRole('row').nth(1)).toBeVisible()],
    ['/account?tab=rules&section=checks', () => expect(page.getByRole('heading', { name: 'Как проверяется допуск клейма', exact: true })).toBeVisible()],
    ['/account?tab=guide', () => expect(page.getByRole('heading', { name: 'Как работать в системе', exact: true })).toBeVisible()],
    ['/settings', () => expect(page.getByRole('button', { name: 'Данные', exact: true })).toBeVisible()],
  ]
  try {
    for (let round = 0; round < 3; round++) for (const [route, ready] of sections) {
      await probe.measure(`${round === 0 ? 'first' : 'warm'}:${round}:${route}`, async () => { await page.goto(route); await ready() })
      if (round === 0) await probe.measure(`refresh:${route}`, async () => { await page.reload(); await ready() })
    }
  } finally { await probe.finish() }
})

test('reports: native wheel, horizontal movement and resize with expanded groups', async ({ page }, info) => {
  test.setTimeout(600000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    for (const route of ['journal', 'lnk', 'psto']) {
      await page.goto(`/${route}`); await reportReady(page)
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(SMOOTHNESS_PROJECT)
      await expect(page.getByText('Найдено: 5000', { exact: true })).toBeVisible({ timeout: 60000 })
      const grid = page.locator('.journal-grid-frame')
      await page.waitForLoadState('networkidle')
      for (let round = 0; round < 3; round++) {
        await probe.scroll(`${route}:vertical:${round}`, grid)
        await probe.scroll(`${route}:horizontal:${round}`, grid, true)
        await probe.resize(`${route}:resize:${round}`, grid, 'line')
      }
      for (const column of ['line', 'projectTitle', 'subtitleCode']) {
        await grid.locator(`.ag-header-cell[col-id="${column}"]`).click({ button: 'right' })
        await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
      }
      await probe.measure(`${route}:expand-groups`, async () => {
        await grid.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
        await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
        await expect(grid.locator('.ag-row:not(.ag-row-group) .ag-cell[col-id="joint"]').first()).toHaveText(/^(?:F|ОП)\d+/)
        await expect(grid).toHaveAttribute('aria-busy', 'false')
      })
      for (let round = 0; round < 3; round++) {
        await probe.scroll(`${route}:group-vertical:${round}`, grid)
        await probe.scroll(`${route}:group-horizontal:${round}`, grid, true)
        await probe.resize(`${route}:group-resize:${round}`, grid, 'line')
      }
    }
  } finally { await probe.finish() }
})

test('statistics: every tab, both support tables, welder details and line summary', async ({ page }, info) => {
  test.setTimeout(600000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    const main = page.getByRole('main')
    for (let round = 0; round < 3; round++) for (const tab of ['Общая', 'ЛНК', 'ПСТО', 'Опоры', 'Сварщики', 'Полинейная сводка']) {
      await probe.measure(`statistics:${tab}:${round}`, async () => {
        await main.getByRole('button', { name: tab, exact: true }).click()
        if (tab !== 'Полинейная сводка') {
          await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
          await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(SMOOTHNESS_PROJECT.toLowerCase())
        }
        await expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled({ timeout: 60000 })
      })
      if (round === 0 && ['Опоры', 'Сварщики', 'Полинейная сводка'].includes(tab)) {
        const grids = main.getByRole('grid')
        for (let i = 0; i < await grids.count(); i++) {
          await probe.scroll(`${tab}:grid${i}:vertical`, grids.nth(i))
          await probe.resize(`${tab}:grid${i}:resize`, grids.nth(i))
        }
        if (tab === 'Сварщики') {
          const stamp = page.locator('[data-statistics-grid="welders"] [col-id="stamp"]').getByRole('button').first()
          await probe.measure('statistics:welder-detail-open', async () => { await stamp.click(); await expect(page.getByText('Динамика по дням', { exact: true })).toBeVisible() })
          await probe.scroll('statistics:welder-expanded-scroll', main.getByRole('grid'))
          await stamp.click()
        }
      }
    }
  } finally { await probe.finish() }
})
