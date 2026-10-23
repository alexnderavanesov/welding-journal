import { expect, type Page } from '@playwright/test'

export async function openDocumentOperation(page: Page, names: string[], kind = 'Заявка ПСТО', action: 'split' | 'rename' | 'merge' = 'split', timeout = 15_000) {
  await page.goto('/documents')
  await page.getByRole('button', { name: kind, exact: true }).click()
  const grid = page.locator('[data-document-history-grid]')
  const viewport = grid.locator('.ag-grid-viewport')
  const selectAll = grid.getByRole('checkbox', { name: 'Выбрать все документы', exact: true })
  await expect(selectAll).toBeEnabled({ timeout })
  if (!await grid.getByText('Выбрано: 0', { exact: true }).count()) {
    await page.keyboard.press('Escape')
    await expect(grid.getByText('Выбрано: 0', { exact: true })).toBeVisible()
  }
  const expected = new Set(names), remaining = new Set(names), seen = new Set<string>()
  expect(expected.size).toBe(names.length)
  // The large fixtures select the complete registry. Verify every encountered
  // title, then select the entire filtered registry with the header checkbox.
  const wholeRegistry = await grid.getByText(`Найдено: ${names.length}`, { exact: true }).count() > 0
  await viewport.scrollIntoViewIfNeeded()
  // A second visit may still be restoring its saved bottom block. Declare a
  // real operator navigation intent before positioning the test at the start;
  // a bare scrollTop write cannot cancel the restore's own asynchronous writes.
  await grid.locator('.ag-header-cell[col-id="title"]').press('Home')
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const visibleRows = () => grid.evaluate(element => {
    const viewportElement = element.querySelector('.ag-grid-viewport')!
    const viewport = viewportElement.getBoundingClientRect()
    const header = element.querySelector('.ag-header')!.getBoundingClientRect()
    // The bounding rect includes the native horizontal scrollbar. Its gutter
    // can cover a checkbox even when the checkbox is inside that outer rect.
    const top = Math.max(viewport.top, header.bottom), bottom = Math.min(viewport.top + viewportElement.clientHeight, window.innerHeight)
    return Array.from(element.querySelectorAll<HTMLElement>('.ag-row[row-id]')).flatMap(row => {
      const title = row.querySelector('[col-id="title"] button')?.textContent?.trim()
      const control = row.querySelector<HTMLInputElement>('input[type="checkbox"]')
      const checkbox = control?.getBoundingClientRect()
      // A partially visible row can leave its checkbox under the sticky header.
      // Click only fully exposed controls; overlapping scroll steps visit the rest.
      const exposed = control && checkbox && document.elementFromPoint(checkbox.left + checkbox.width / 2, checkbox.top + checkbox.height / 2) === control
      return title && checkbox && exposed && checkbox.top >= top + 1 && checkbox.bottom <= bottom - 1
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
        if (!wholeRegistry) {
          const checkbox = grid.locator(`.ag-row[row-id="${row.id}"]`).getByRole('checkbox')
          if (!await checkbox.isChecked()) {
            // Re-read after previous selections: focus and toolbar updates can
            // move the viewport. Avoid locator.check's extra native autoscroll.
            const point = await checkbox.evaluate(element => {
              const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2
              return document.elementFromPoint(x, y) === element ? { x, y } : null
            })
            if (!point) continue
            await page.mouse.click(point.x, point.y)
            await expect(checkbox).toBeChecked()
          }
        }
        remaining.delete(row.title)
      }
      seen.add(row.id)
    }
    if (!remaining.size) break
    // The document owns vertical scrolling; use the same wheel gesture as
    // an operator instead of writing AG Grid's internal viewport offset.
    const before = await page.evaluate(() => window.scrollY)
    const box = (await viewport.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, Math.min(850, box.y + 160))
    await page.mouse.wheel(0, Math.max(200, box.height * 0.65))
    await expect.poll(() => page.evaluate(() => window.scrollY), {
      timeout: Math.max(1, deadline - Date.now()),
      message: `Documents not found in registry: ${[...remaining].slice(0, 5).join(', ')}`,
    }).toBeGreaterThan(before)
  }
  if (wholeRegistry) {
    await selectAll.click()
    await expect(selectAll).toBeChecked()
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
