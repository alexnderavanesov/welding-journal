import { expect, test } from '@playwright/test'

test('контурное меню: все разделы, мягкая подсветка, клавиатура и сворачивание', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  const sidebar = page.locator('[data-app-sidebar]')
  const sections = [
    ['Сварочный журнал', '/journal', 'clipboard-list'],
    ['Программа линий', '/line-program', 'list-tree'],
    ['ПСТО и ТВМТ', '/psto', 'flame'],
    ['ЛНК', '/lnk', 'clipboard-check'],
    ['Клейма', '/welder-stamps', 'stamp'],
    ['Статистика', '/statistics', 'chart-column'],
    ['Документы', '/documents', 'file-text'],
    ['Настройки', '/settings', 'settings'],
    ['Руководство пользователя', '/user-guide', 'book-open-text'],
  ]
  for (const collapsed of [false, true]) {
    // The shorter viewport also checks that the enlarged icons do not hide sections.
    await page.setViewportSize({ width: 1000, height: 620 })
    const toggle = sidebar.getByRole('button', { name: collapsed ? 'Скрыть меню' : 'Раскрыть меню', exact: true })
    if (await toggle.count()) await toggle.click()
    await expect(sidebar).toHaveCSS('width', collapsed ? '64px' : '192px')
    for (const [label, path, icon] of sections) {
      const button = sidebar.getByRole('button', { name: label, exact: true })
      await expect(button.locator('svg')).toHaveClass(new RegExp(`lucide-${icon}`))
      await expect(button.locator('svg')).toHaveAttribute('stroke-width', '1.5')
      await button.focus()
      await button.press('Enter')
      await expect(page).toHaveURL(new RegExp(path + '$'))
      await expect(button).toHaveAttribute('aria-current', 'page')
      await expect(button).toHaveCSS('background-color', 'rgb(240, 249, 255)')
      await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1)
      expect(await button.evaluate(el => {
        const box = el.getBoundingClientRect()
        return box.top >= 0 && box.bottom <= window.innerHeight && el.scrollWidth <= el.clientWidth
      })).toBe(true)
      expect(await sidebar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
  }
  await sidebar.getByRole('button', { name: 'Программа линий', exact: true }).click()
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.screenshot({ path: 'outputs/sidebar-outline-compact.png' })
  await sidebar.getByRole('button', { name: 'Раскрыть меню', exact: true }).click()
  await expect(sidebar).toHaveCSS('width', '256px')
  await page.screenshot({ path: 'outputs/sidebar-outline-full.png' })
  expect(errors).toEqual([])
})
