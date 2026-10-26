import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E statistics filter focus'

test('a deferred checkbox refocus cannot steal the newer filter search focus', async ({ page }) => {
  try {
    await withE2eDatabase(async db => {
      await db.query(`insert into weld_joints(project_title,line,joint,weld_date,connection_type,stamp_1_k_fact)
        values ($1,'FILTER','F1','2026-09-01','С17','FOCUS1')`, [project])
      await db.query('delete from derived_calculation_cache')
      await db.query('update derived_calculation_state set source_revision=source_revision+1,updated_at=now() where id=1')
    })
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Сварщики', exact: true }).click()
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(project.toLowerCase())
    await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('custom')
    await page.getByLabel('Период с', { exact: true }).fill('2026-09-01')
    await page.getByLabel('Период по', { exact: true }).fill('2026-09-30')
    const grid = page.locator('[data-statistics-grid="welders"]')
    await expect(grid.getByText('FOCUS1', { exact: true })).toBeVisible()
    await grid.locator('[col-id="stamp"] .ag-header-cell-filter-button').click()
    const filter = page.locator('.ag-filter').filter({ visible: true })
    await expect(filter.getByRole('checkbox', { name: 'FOCUS1', exact: true })).toBeVisible()
    // In the same turn, move to the search after changing a checkbox. The
    // library's pending timeout/frame must not take ownership back afterwards.
    await filter.evaluate(async element => {
      const checkbox = element.querySelector<HTMLInputElement>('input[type=checkbox]')!
      checkbox.closest<HTMLElement>('.ag-virtual-list-item')!.focus()
      checkbox.click()
      element.querySelector<HTMLInputElement>('input[type=text]')!.focus()
      await new Promise(resolve => setTimeout(resolve, 0))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    await expect(filter.getByRole('textbox')).toBeFocused()
    await page.keyboard.type('FOCUS1')
    await expect(filter.getByRole('textbox')).toHaveValue('FOCUS1')
    await expect(filter.getByRole('checkbox', { name: 'FOCUS1', exact: true })).toBeVisible()
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
  }
})
