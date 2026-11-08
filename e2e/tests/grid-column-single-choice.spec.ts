import { expect, test } from '@playwright/test'
import { rpcName } from '../rpc'

for (const path of ['/journal', '/lnk', '/psto']) {
  test(`${path}: скрытая группа позволяет включить один столбец и сохранить частичный вид`, async ({ page }) => {
    const errors: string[] = [], calls: string[] = []
    const section = path === '/lnk' ? 'НК до ТО' : 'Сварка'
    const field = path === '/lnk' ? 'preVikResult' : 'weldingMethod'
    const sibling = path === '/lnk' ? 'preVikRequest' : 'connectionType'
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
    await page.goto(path)
    const grid = page.locator('[data-weld-report-grid]')
    await expect(grid.locator('.ag-row').first()).toBeVisible()
    await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    const panel = page.getByRole('dialog', { name: /^Настройка вида/ })
    await panel.getByRole('button', { name: 'Показать все', exact: true }).click()
    const group = panel.getByRole('checkbox', { name: `Раздел: ${section}`, exact: true })
    if (path === '/lnk') {
      // The attached recording uses the expanded section without searching.
      await group.locator('xpath=ancestor::summary').locator(':scope > svg').click()
    } else await panel.getByRole('textbox', { name: 'Найти столбец или раздел' }).fill(section)
    const result = panel.getByRole('checkbox', { name: path === '/lnk' ? 'Результат ВИК до ТО' : 'Способ сварки', exact: true })
    const request = panel.getByRole('checkbox', { name: path === '/lnk' ? 'Заявка ВИК до ТО' : 'Тип соединения', exact: true })
    await expect(result).toBeVisible()
    await page.waitForLoadState('networkidle')
    const before = calls.length
    await group.uncheck()
    await expect(result).not.toBeChecked()
    await result.check()
    await expect(result).toBeChecked()
    await expect(request).not.toBeChecked()
    await expect(group).toBeChecked({ indeterminate: true })
    const chosen = () => group.locator('xpath=ancestor::details').locator('.journal-column-option input:checked:not(:disabled)')
    await expect(chosen()).toHaveCount(1)
    // Hiding a partially selected view must not require showing every column first.
    await panel.getByRole('button', { name: 'Скрыть все', exact: true }).click()
    await result.check()
    await expect(chosen()).toHaveCount(1)
    await expect(grid.locator(`.ag-header-cell[col-id="${field}"]`)).toBeVisible()
    await expect(grid.locator(`.ag-header-cell[col-id="${sibling}"]`)).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    expect(calls.length).toBe(before)
    await panel.getByRole('button', { name: 'Закрыть настройки вида' }).click()
    await page.reload()
    await expect(grid.locator(`.ag-header-cell[col-id="${field}"]`)).toBeVisible()
    await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    await panel.getByRole('textbox', { name: 'Найти столбец или раздел' }).fill(section)
    await expect(chosen()).toHaveCount(1)
    await expect(group).toBeChecked({ indeterminate: true })
    await group.check()
    await expect(request).toBeChecked()
    await group.uncheck()
    await expect(chosen()).toHaveCount(0)
    await result.focus()
    await result.press('Space')
    await expect(chosen()).toHaveCount(1)
    await expect(group).toBeChecked({ indeterminate: true })
    await expect(group).toHaveCSS('background-color', 'rgb(2, 132, 199)')
    await expect.poll(() => group.evaluate(element => getComputedStyle(element, '::after').height)).toBe('2px')
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.screenshot({ path: `outputs/filter-clear-selection-2026-11-07/${path.slice(1)}-single-column.png` })
    expect(errors).toEqual([])
  })
}

for (const [path, gridSelector, panelName, column, colId] of [
  ['/line-program', '[data-program-grid="lines"]', 'Вид программы линий', 'Клейм', 'stamps'],
  ['/documents', '[data-document-history-grid="generated:weldingJournal"]', 'Настройка вида документов', 'Проект', 'project'],
] as const) {
  test(`${path}: скрыть все из частичного вида и оставить один необязательный столбец`, async ({ page }) => {
    await page.goto(path)
    const grid = page.locator(gridSelector)
    await expect(grid).toBeVisible()
    await page.getByRole('button', { name: path === '/line-program' ? 'Настроить вид программы линий' : 'Настроить вид', exact: true }).click()
    const panel = page.getByRole('dialog', { name: panelName, exact: true })
    await panel.getByRole('button', { name: 'Показать все', exact: true }).click()
    await panel.getByRole('checkbox', { name: column, exact: true }).uncheck()
    await panel.getByRole('button', { name: 'Скрыть все', exact: true }).click()
    await expect(panel.locator('.journal-column-option input:checked:not(:disabled)')).toHaveCount(0)
    await panel.getByRole('checkbox', { name: column, exact: true }).check()
    await expect(panel.locator('.journal-column-option input:checked:not(:disabled)')).toHaveCount(1)
    await expect(grid.locator(`.ag-header-cell[col-id="${colId}"]`)).toBeVisible()
    await panel.getByRole('button', { name: 'Закрыть настройки вида' }).click()
    // Program visibility belongs to the open page; only width/order and
    // appearance persist across reloads (the existing agreed lifetime).
    if (path === '/documents') {
      await page.reload()
      await expect(grid.locator(`.ag-header-cell[col-id="${colId}"]`)).toBeVisible()
    }
    await page.getByRole('button', { name: path === '/line-program' ? 'Настроить вид программы линий' : 'Настроить вид', exact: true }).click()
    await expect(panel.locator('.journal-column-option input:checked:not(:disabled)')).toHaveCount(1)
  })
}
