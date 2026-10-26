import { expect, type Page } from '@playwright/test'

export async function filterPstoExceptions(page: Page, grid: string, field: string, value: string) {
  await page.getByRole('grid', { name: grid, exact: true }).locator(`.ag-header-cell[col-id="${field}"] .ag-header-cell-filter-button`).click()
  const panel = page.getByRole('dialog', { name: /^Фильтр:/ })
  await panel.getByRole('textbox', { name: 'Найти значение фильтра' }).fill(value)
  const option = panel.locator('label').filter({ has: page.getByText(value, { exact: true }) })
  await expect(option).toBeVisible()
  await option.getByRole('checkbox').check()
  // The popup must survive the server result and grid refresh, so users can
  // select several values before closing it themselves.
  await expect(page.getByRole('grid', { name: grid, exact: true }).locator('..').getByText('Загрузка…', { exact: true })).toBeHidden()
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Закрыть фильтр' }).click()
}
