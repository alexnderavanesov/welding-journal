import { expect, type Page } from '@playwright/test'

export function documentGrid(page: Page) {
  return page.locator('[data-document-history-grid]')
}

export async function documentGridRow(page: Page, title: string, stage?: string) {
  const grid = documentGrid(page)
  const titles = grid.getByRole('button', { name: title, exact: true })
  await expect(grid.locator('.document-grid-frame')).toBeVisible()
  await expect(grid.locator('.document-grid-frame')).not.toHaveAttribute('data-journal-updating', '')
  // A bounded server block can contain more rows than AG Grid mounts. Find the
  // requested document by scrolling, without changing its filter or exact scope.
  if (!await titles.count()) {
    const viewport = grid.locator('.ag-grid-viewport')
    await expect(grid.locator('.ag-row [col-id="title"] button').first()).toBeVisible()
    // The registry's vertical scroll belongs to the page. Writing the inner
    // viewport position races its page-scroll adapter and a filter replacement.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await viewport.hover()
    for (let step = 0; step < 40 && !await titles.count(); step++) {
      const before = await page.evaluate(() => window.scrollY)
      await page.mouse.wheel(0, await viewport.evaluate(element => Math.max(200, element.clientHeight * 0.65)))
      await grid.locator('.document-grid-footer').getByText('Загрузка…', { exact: true }).waitFor({ state: 'hidden' })
      await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
      await expect(grid.locator('.document-grid-frame')).not.toHaveAttribute('data-journal-updating', '')
      await page.evaluate(async () => {
        let previous = window.scrollY, stable = 0
        for (let frame = 0; frame < 60 && stable < 3; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          const next = window.scrollY
          stable = next === previous ? stable + 1 : 0
          previous = next
        }
      })
      if (await page.evaluate(() => window.scrollY) === before) break
    }
  }
  // During a purge AG briefly retains the old row's children after removing
  // its live row class. Wait for that copy to leave; never choose an arbitrary
  // duplicate title. Different stages may legitimately share a title.
  if (!stage) await expect(titles).toHaveCount(1)
  else await expect(titles.first()).toBeVisible()
  if (stage) await revealDocumentColumn(page, 'stage')
  let matchingIds: string[] = []
  await expect.poll(async () => {
    matchingIds = []
    for (const button of await titles.all()) {
      const id = await button.evaluate(element => element.closest('.ag-row')?.getAttribute('row-id'))
      if (!id) continue
      const center = grid.locator(`.ag-row[row-id="${id}"]`)
      if (!stage || await center.getByText(stage, { exact: true }).count()) matchingIds.push(id)
    }
    return matchingIds.length
  }).toBe(1)
  const id = matchingIds[0]
  const left = grid.locator(`.ag-row[row-id="${id}"]`)
  await expect(left).toHaveCount(1)
  return {
    id,
    left,
    center: grid.locator(`.ag-row[row-id="${id}"]`),
    actions: grid.locator(`.ag-row[row-id="${id}"] [col-id="__actions"]`),
    checkbox: left.getByRole('checkbox'),
    titleCell: left.locator('[col-id="title"]'),
  }
}

export async function revealDocumentColumn(page: Page, field: string) {
  const grid = documentGrid(page)
  const viewport = grid.locator('.ag-grid-viewport')
  const header = grid.locator(`.ag-header-cell[col-id="${field}"]`)
  await viewport.evaluate(element => { element.scrollLeft = 0 })
  for (let step = 0; step < 30; step++) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    if (await header.count()) {
      await header.scrollIntoViewIfNeeded()
      await expect(header).toBeVisible()
      return header
    }
    await viewport.evaluate(element => { element.scrollLeft += 400 })
  }
  await expect(header).toBeVisible()
  return header
}

export async function openDocumentGridFilter(page: Page, field: string, label: string) {
  const header = await revealDocumentColumn(page, field)
  await header.locator('.ag-header-cell-filter-button').click()
  const dialog = page.getByRole('dialog', { name: `Фильтр: ${label}`, exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

export async function openDocumentGridColumnMenu(page: Page, field: string, keyboard = false) {
  const header = await revealDocumentColumn(page, field)
  if (keyboard) {
    await header.focus()
    await header.press('Shift+F10')
  } else {
    await header.click({ button: 'right' })
  }
  await expect(page.getByRole('menuitem', { name: 'Выбрать столбцы', exact: true })).toBeVisible()
  return header
}
