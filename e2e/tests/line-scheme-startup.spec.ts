import { expect, test } from '@playwright/test'

test('PDF-модули не загружаются при запуске журнала и открытии реестра схем', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await expect(page.locator('.ag-root').first()).toBeVisible()
  await page.getByRole('button', { name: 'Схемы линий', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Схемы линий', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Поиск линий' })).toHaveCount(0)
  await expect(page.locator('.ag-root').first()).toBeVisible()
  const viewerResources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => /line-scheme-pdf|pdfjs|\/pdf-[^/]+\.js|pdf\.worker|pdf\.renderer|\.wasm/.test(url)))
  expect(viewerResources).toEqual([])
  await page.getByRole('button', { name: 'Сварочный журнал', exact: true }).click()
  await expect(page.locator('.ag-root').first()).toBeVisible()
  await expect(page).toHaveURL(/\/journal$/)
  expect(page.workers()).toHaveLength(0)
  expect(errors).toEqual([])
})
