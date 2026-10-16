import { expect, type Page } from '@playwright/test'

/** AG Grid keeps the weld ID even for same-name joints and after chain renaming. */
export function journalRow(page: Page, id: number | undefined) {
  if (id === undefined) throw new Error('The journal fixture is missing a weld ID.')
  return page.locator(`[data-welding-journal-grid] .ag-grid-scrolling-rows .ag-row[row-id="${id}"]`)
}

/** Use the visible checkbox, not the retired HTML table's selection button. */
export async function selectJournalJoint(page: Page, id: number | undefined) {
  await journalRow(page, id).getByRole('checkbox').check()
}

/** Reveal a virtualized column through the grid's native horizontal viewport. */
export async function revealJournalColumn(page: Page, colId: string) {
  const grid = page.locator('[data-welding-journal-grid]')
  const viewport = grid.locator('.ag-grid-viewport')
  await expect(viewport).toBeVisible()
  const header = grid.locator(`.ag-header-cell[col-id="${colId}"]`)
  await viewport.evaluate(async element => {
    element.scrollLeft = 0
    // Resetting after a previous reveal removes the old right-hand headers.
    // Wait for AG's virtual columns before looking up the next target node.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  const steps = await viewport.evaluate(element => Math.ceil(element.scrollWidth / Math.max(element.clientWidth / 2, 1)) + 1)
  for (let step = 0; step <= steps; step++) {
    if (await header.count()) {
      await header.scrollIntoViewIfNeeded()
      return
    }
    await viewport.evaluate(async element => {
      element.scrollLeft += Math.max(element.clientWidth / 2, 1)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
  }
  await expect(header, `Journal column ${colId} should be available`).toBeVisible()
}

/** Keep deletion coverage on the actual row action, including its confirmation. */
export async function deleteJournalJoint(page: Page, id: number | undefined) {
  await revealJournalColumn(page, '__actions')
  await journalRow(page, id).getByRole('button', { name: 'Удалить', exact: true }).click()
}

/** Opens the real edit workflow without depending on an off-screen action column. */
export async function editJournalJoint(page: Page, joint: string | number | undefined) {
  const button = typeof joint === 'string'
    ? page.locator('[data-welding-journal-grid]').getByRole('button', { name: joint, exact: true })
    : journalRow(page, joint).locator('[col-id="joint"]').getByRole('button')
  await expect(button).toBeVisible()
  await button.click({ button: 'right' })
  await page.getByRole('button', { name: 'Редактировать стык', exact: true }).click()
}
