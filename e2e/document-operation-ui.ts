import { expect, type Page } from '@playwright/test'

export async function openDocumentOperation(page: Page, names: string[], kind = 'Заявка ПСТО', action: 'split' | 'rename' | 'merge' = 'split', timeout = 15_000) {
  await page.goto('/documents')
  await page.getByRole('button', { name: kind, exact: true }).click()
  const grid = page.locator('[data-document-history-grid]')
  const viewport = grid.locator('.ag-grid-viewport')
  const selectLoaded = grid.getByRole('checkbox', { name: 'Выбрать загруженные документы', exact: true })
  await expect(selectLoaded).toBeEnabled({ timeout })
  if (!await grid.getByText('Выбрано: 0', { exact: true }).count()) {
    await page.keyboard.press('Escape')
    await expect(grid.getByText('Выбрано: 0', { exact: true })).toBeVisible()
  }
  const expected = new Set(names), remaining = new Set(names), seen = new Set<string>()
  expect(expected.size).toBe(names.length)
  // The large fixtures select the complete registry. Verify every encountered
  // title, then explicitly select each loaded portion; later blocks stay unselected.
  const wholeRegistry = await grid.getByText(`Найдено: ${names.length}`, { exact: true }).count() > 0
  await viewport.scrollIntoViewIfNeeded()
  // A second visit may still be restoring its saved bottom block. Declare a
  // real operator navigation intent before positioning the test at the start;
  // a bare scrollTop write cannot cancel the restore's own asynchronous writes.
  await grid.locator('.ag-header-cell[col-id="title"]').press('Home')
  await viewport.evaluate(element => { element.scrollTop = 0 })
  const visibleRows = () => grid.evaluate(element => {
    const viewport = element.querySelector('.ag-grid-viewport')!.getBoundingClientRect()
    const header = element.querySelector('.ag-header')!.getBoundingClientRect()
    const top = Math.max(viewport.top, header.bottom), bottom = Math.min(viewport.bottom, window.innerHeight)
    return Array.from(element.querySelectorAll<HTMLElement>('.ag-row[row-id]')).flatMap(row => {
      const title = row.querySelector('[col-id="title"] button')?.textContent?.trim()
      const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.getBoundingClientRect()
      // A partially visible row can leave its checkbox under the sticky header.
      // Click only fully exposed controls; overlapping scroll steps visit the rest.
      return title && checkbox && checkbox.top >= top + 1 && checkbox.bottom <= bottom - 1
        ? [{ id: row.getAttribute('row-id')!, title }] : []
    })
  })
  const deadline = Date.now() + timeout
  while (remaining.size) {
    // Native scroll mounts loading stubs before the debounced server request.
    // Do not advance past a half-loaded viewport or mistake its final stub for
    // the end of the registry. Two frames let AG process the preceding scroll.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(grid.locator('.ag-row-loading')).toHaveCount(0, { timeout: Math.max(1, deadline - Date.now()) })
    await expect(grid.getByText('Загрузка…', { exact: true })).toBeHidden({ timeout: Math.max(1, deadline - Date.now()) })
    let previousPosition = ''
    await expect.poll(async () => {
      const position = await viewport.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return JSON.stringify([element.scrollTop, element.scrollLeft, rect.top, rect.bottom, window.scrollY])
      })
      const settled = position === previousPosition
      previousPosition = position
      return settled
    }, { timeout: Math.max(1, deadline - Date.now()), intervals: [50, 100, 200] }).toBe(true)
    await expect.poll(async () => (await visibleRows()).some(row => !seen.has(row.id)), { timeout: Math.max(1, deadline - Date.now()) }).toBe(true)
    for (const row of await visibleRows()) {
      if (wholeRegistry) expect(expected.has(row.title), `Unexpected document in the complete selection: ${row.title}`).toBe(true)
      if (expected.has(row.title)) {
        remaining.delete(row.title)
        if (!wholeRegistry) await grid.locator(`.ag-row[row-id="${row.id}"]`).getByRole('checkbox').check()
      }
      seen.add(row.id)
    }
    if (wholeRegistry) {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await selectLoaded.check()
    }
    if (!remaining.size) break
    const moved = await viewport.evaluate(element => {
      const before = element.scrollTop
      element.scrollTop += Math.max(200, element.clientHeight * 0.65)
      return element.scrollTop > before
    })
    expect(moved, `Documents not found in registry: ${[...remaining].slice(0, 5).join(', ')}`).toBe(true)
  }
  await expect(grid.getByText(`Выбрано: ${names.length}`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Действия с документами, выбрано:/ }).click()
  await page.getByRole('button', { name: action === 'split' ? 'Изменить разделение' : action === 'merge' ? 'Объединить' : 'Переименовать', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: action === 'split' ? 'Изменить разделение' : action === 'merge' ? 'Объединить документы' : 'Переименовать документы', exact: true })
  await expect(dialog.getByRole('textbox', { name: /^Название:/ }).first()).toBeVisible({ timeout })
  return dialog
}

export async function confirmDocumentOperation(dialog: ReturnType<Page['getByRole']>, packet = 1, timeout = 15_000) {
  const apply = dialog.getByRole('button', { name: 'Подтвердить и применить', exact: true })
  await expect(apply).toBeEnabled()
  await apply.click()
  const saved = dialog.getByRole('status').filter({ hasText: `Сохранено пакетов: ${packet}` })
  // A server refusal is a result to investigate, not a four-minute slow save.
  await expect(saved.or(dialog.getByRole('alert'))).toBeVisible({ timeout })
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(saved).toBeVisible()
}
