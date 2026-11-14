import { expect, test, type Page } from '@playwright/test'

async function expectSearchAvailable(page: Page) {
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })
  const settings = page.getByRole('button', { name: 'Настроить вид', exact: true })
  await expect.poll(async () => {
    const input = (await search.boundingBox())!, button = (await settings.boundingBox())!
    return input.width >= 130 && input.x + input.width <= button.x - 6
  }).toBe(true)
  const input = (await search.boundingBox())!, button = (await settings.boundingBox())!
  expect(input.width).toBeGreaterThanOrEqual(130)
  expect(input.x + input.width).toBeLessThanOrEqual(button.x - 6)
  expect(await search.evaluate(element => {
    const bounds = element.getBoundingClientRect(), label = element.closest('label')!
    return [0.1, 0.5, 0.9].every(part => label.contains(document.elementFromPoint(bounds.left + bounds.width * part, bounds.top + bounds.height / 2)))
  })).toBe(true)
  const summary = page.locator('.journal-summary > div > span').first()
  await expect.poll(() => summary.evaluate(element => element.getAttribute('title') === element.textContent)).toBe(true)
}

for (const path of ['/journal', '/lnk', '/psto']) test(`${path}: narrow toolbar keeps search reachable beside view settings and grouping`, async ({ page }, info) => {
  await page.setViewportSize({ width: 900, height: 740 })
  await page.goto(path)
  await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  await expectSearchAvailable(page)
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })
  await search.fill('UX-needle-not-found')
  await expect(search).toHaveValue('UX-needle-not-found')
  await expect(page.getByRole('button', { name: 'Сбросить', exact: true })).toBeVisible()
  await expectSearchAvailable(page)
  await page.getByRole('button', { name: 'Очистить быстрый поиск', exact: true }).click()
  await expect(search).toHaveValue('')
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  await expect(page.getByRole('button', { name: 'Группировка: Линия', exact: true })).toBeVisible()
  await expectSearchAvailable(page)
  await page.screenshot({ path: info.outputPath('narrow-search-and-grouping.png') })
})

test('account direct guide link and history keep the selected narrow tab visible without scrolling the page', async ({ page }, info) => {
  await page.setViewportSize({ width: 900, height: 740 })
  await page.goto('/account?tab=guide')
  const list = page.getByRole('tablist', { name: 'Аккаунт и доступ', exact: true })
  const selected = list.locator('[aria-selected="true"]')
  const visible = async () => {
    const bounds = (await list.boundingBox())!, tab = (await selected.boundingBox())!
    return tab.x >= bounds.x - 1 && tab.x + tab.width <= bounds.x + bounds.width + 1
  }
  await expect(selected).toHaveText('Руководство')
  await expect.poll(visible).toBe(true)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await list.getByRole('tab', { name: 'Мой профиль', exact: true }).click()
  await expect(selected).toHaveText('Мой профиль')
  await expect.poll(visible).toBe(true)
  await page.goBack()
  await expect(selected).toHaveText('Руководство')
  await expect.poll(visible).toBe(true)
  await expect(page.getByRole('heading', { name: 'Как работать в системе', exact: true })).toBeVisible()
  // Keep the two resize commands adjacent: their final strip width can be
  // identical to the last ResizeObserver delivery, despite scroll clamping.
  for (let round = 0; round < 6; round++) {
    await page.setViewportSize({ width: 1600, height: 740 })
    await page.setViewportSize({ width: 900, height: 740 })
    await expect.poll(visible).toBe(true)
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await page.evaluate(() => window.scrollTo(0, 200))
  const position = await page.evaluate(() => window.scrollY)
  // Resize only the tab strip, preserving the page's vertical layout. Resizing
  // the whole responsive guide can legitimately invoke native scroll anchoring.
  await list.evaluate(element => { element.scrollLeft = 0; element.style.maxWidth = '600px' })
  await expect.poll(visible).toBe(true)
  expect(await page.evaluate(() => window.scrollY)).toBe(position)
  await page.screenshot({ path: info.outputPath('narrow-account-active-tab.png') })
})
