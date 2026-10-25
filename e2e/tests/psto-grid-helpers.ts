import { expect, type Page } from '@playwright/test'

export function pstoRow(page: Page, joint: string) {
  return page.locator('[data-psto-grid] .ag-grid-scrolling-rows .ag-row')
    .filter({ has: page.getByRole('button', { name: joint, exact: true }) })
}

/** Reveal a real virtualized column before using its operator-facing action. */
export async function revealPstoColumn(page: Page, colId: string) {
  const grid = page.locator('[data-psto-grid]')
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
    if (await header.count()) {
      await header.evaluate(element => element.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' }))
      return
    }
    await viewport.evaluate(async element => {
      element.scrollLeft += Math.max(element.clientWidth / 2, 1)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
  }
  await expect(header, `PSTO column ${colId} should be available`).toBeVisible()
}

export async function pstoActionRow(page: Page, joint: string, column = 'jointNextAction') {
  const row = pstoRow(page, joint)
  await expect(row).toBeVisible()
  // Search keeps old rows visible while their actions are unavailable. Wait for
  // the requested result before moving its horizontal viewport.
  await expect(page.locator('[data-psto-grid] .journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  await expect(row.getByRole('checkbox')).toBeEnabled()
  await revealPstoColumn(page, column)
  return row
}
