import { expect, type Page } from '@playwright/test'

export function lnkRow(page: Page, joint: string) {
  return page.locator('[data-lnk-grid] .ag-grid-scrolling-rows .ag-row')
    .filter({ has: page.getByRole('button', { name: joint, exact: true }) })
}

export async function revealLnkColumn(page: Page, colId: string) {
  const grid = page.locator('[data-lnk-grid]')
  await expect(grid.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  const viewport = grid.locator('.ag-grid-viewport')
  await expect(viewport).toBeVisible()
  const header = grid.locator(`.ag-header-cell[col-id="${colId}"]`)
  await viewport.evaluate(async element => {
    element.scrollLeft = 0
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  const steps = await viewport.evaluate(element => Math.ceil(element.scrollWidth / Math.max(element.clientWidth / 2, 1)) + 1)
  for (let step = 0; step <= steps; step++) {
    if (await header.count()) { await header.scrollIntoViewIfNeeded(); return }
    await viewport.evaluate(async element => {
      element.scrollLeft += Math.max(element.clientWidth / 2, 1)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
  }
  await expect(header, `LNK column ${colId} should be available`).toBeVisible()
}

export async function selectLnkRow(page: Page, joint: string) {
  const row = lnkRow(page, joint)
  await expect(row).toBeVisible()
  await expect(page.locator('[data-lnk-grid] .journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  await row.getByRole('checkbox').check()
  return row
}

export async function lnkActionRow(page: Page, joint: string, column = 'jointNextAction') {
  const row = lnkRow(page, joint)
  await expect(row).toBeVisible()
  await expect(row.getByRole('checkbox')).toBeEnabled()
  await revealLnkColumn(page, column)
  return row
}
