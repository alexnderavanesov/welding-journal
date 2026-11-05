import { expect, test } from '@playwright/test'

test('specialist dropdown uses the application popup, keyboard selection and nested Escape', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/references')
  await page.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить специалиста', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Добавление специалиста', exact: true })
  const select = dialog.getByRole('combobox', { name: 'Тип специалиста', exact: true })
  await select.click()
  const popup = dialog.getByRole('listbox')
  await expect(popup).toBeVisible()
  await expect(popup.getByRole('option')).toHaveCount(2)
  for (const option of await popup.getByRole('option').all()) {
    await option.locator('span').first().hover()
    await expect(option).not.toHaveAttribute('title')
    await expect(option.locator('[title]')).toHaveCount(0)
  }
  await page.screenshot({ path: info.outputPath('specialist-select.png') })
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await select.click()
  await popup.getByRole('option', { name: 'Термист', exact: true }).click()
  await expect(select).toHaveValue('thermist')
  await expect(dialog.getByText('Назначено автоматически')).toBeVisible()
  await select.press('ArrowDown')
  await select.press('Home')
  await select.press('Enter')
  await expect(select).toHaveValue('inspector')
  await expect(dialog.getByRole('checkbox', { name: 'ВИК', exact: true })).toBeVisible()
  // Exercise clipping/reasons in this local DOM only; no fixture is saved.
  const longLabel = 'Полное название специальности для проверки обрезанного текста '.repeat(3).trim()
  await select.evaluate((node, label) => {
    const field = node as HTMLSelectElement
    field.add(new Option(label, 'overflow-fixture'))
    const blocked = new Option('Недоступный вариант', 'blocked-fixture')
    blocked.disabled = true; blocked.title = 'Причина недоступности сохраняется'
    field.add(blocked)
  }, longLabel)
  await select.click()
  const longOption = popup.getByRole('option', { name: longLabel.trim(), exact: true })
  const longText = longOption.locator('span').first()
  await longText.hover()
  await expect(longText).toHaveAttribute('title', longLabel)
  const blocked = popup.getByRole('option', { name: 'Недоступный вариант', exact: true })
  await blocked.hover()
  await expect(blocked).toHaveAttribute('title', 'Причина недоступности сохраняется')
  await expect(longText).not.toHaveAttribute('title')
  await page.keyboard.press('Escape')
  await select.click()
  await page.keyboard.press('Tab')
  await expect(popup).toHaveCount(0)
  await expect(dialog.getByLabel('№ квалификационного удостоверения', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(errors).toEqual([])
})

test('journal summary keeps a long WDI total visible before grouping at wide and narrow widths', async ({ page }, info) => {
  await page.goto('/journal')
  const summary = page.locator('.journal-summary > div > span')
  await expect(summary).toContainText('Записей:')
  // Layout-only fixture, without changing records or the production summary.
  await summary.evaluate(element => { element.textContent = 'Записей: 200000 · WDI годных: 1983333,75' })
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1000 })
    const sizes = await summary.evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth, right: element.getBoundingClientRect().right }))
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1)
    const grouping = await page.locator('.journal-grouping').boundingBox()
    expect(grouping!.x).toBeGreaterThan(sizes.right)
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.locator('[data-journal-toolbar]').screenshot({ path: info.outputPath('journal-wdi-toolbar.png') })
})

test('LNK shows the localized empty filter message and restores matching rows', async ({ page }, info) => {
  await page.goto('/lnk')
  const grid = page.locator('[data-lnk-grid]')
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  await search.fill('E2E проект')
  await expect(grid.getByRole('button', { name: 'F1', exact: true })).toBeVisible()

  // Keep a real column filter active: AG distinguishes noMatchingRows from an
  // entirely empty report. The baseline joint comes from global-setup.
  await grid.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Линия' })
  await filter.getByLabel('Найти значение фильтра').fill('E2E-L1')
  // The checkbox's accessible name includes the row count from its label.
  // Select the exact line text without depending on that changing count.
  const lineOption = filter.locator('.journal-filter-option').filter({ has: page.getByText('E2E-L1', { exact: true }) })
  await expect(lineOption).toHaveCount(1)
  await lineOption.getByRole('checkbox').check()
  await page.keyboard.press('Escape')
  await expect(filter).toHaveCount(0)
  await search.fill('E2E-no-matching-joint-localized-overlay')
  await expect(grid.locator('.journal-loaded-count')).toHaveText('Найдено: 0')
  const message = grid.locator('.ag-overlay-no-matching-rows-center')
  await expect(message).toHaveText('По текущему поиску и фильтрам ничего не найдено.')
  await expect(message).toBeVisible()
  await expect(grid.getByText('No Matching Rows', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('lnk-localized-empty-filter.png') })
  await search.fill('E2E проект')
  await expect(grid.getByRole('button', { name: 'F1', exact: true })).toBeVisible()
  await expect(message).toHaveCount(0)
})

test('journal note spans the full form width at desktop and narrow sizes', async ({ page }, info) => {
  await page.goto('/journal')
  await page.getByRole('button', { name: 'Новый стык', exact: true }).click()
  const editor = page.getByRole('dialog')
  const note = editor.getByRole('textbox', { name: 'Примечание сварочный журнал', exact: true })
  await note.fill('Проверка ширины примечания без сохранения стыка')
  for (const width of [1600, 1000, 760]) {
    await page.setViewportSize({ width, height: 1000 })
    await note.scrollIntoViewIfNeeded()
    await expect(note).toBeInViewport()
    const bounds = await note.evaluate(field => {
      let grid = field.parentElement
      while (grid && getComputedStyle(grid).display !== 'grid') grid = grid.parentElement
      if (!grid) throw new Error('The journal note has no form grid')
      const input = field.getBoundingClientRect(), container = grid.getBoundingClientRect()
      return { inputLeft: input.left, inputRight: input.right, gridLeft: container.left, gridRight: container.right }
    })
    expect(Math.abs(bounds.inputLeft - bounds.gridLeft)).toBeLessThanOrEqual(1)
    expect(Math.abs(bounds.inputRight - bounds.gridRight)).toBeLessThanOrEqual(1)
    await expect(note).toHaveValue('Проверка ширины примечания без сохранения стыка')
    await editor.screenshot({ path: info.outputPath(`journal-note-full-width-${width}.png`) })
  }
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(editor).toHaveCount(0)
})
