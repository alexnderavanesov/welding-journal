import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { openDocumentGridFilter } from '../document-grid'

const project = 'E2E method column video regression'
test.beforeEach(async () => {
  await withE2eDatabase(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
    has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,
    has_rk,rk_result,rk_request,rk_request_date,rk_conclusion,rk_conclusion_date)
    values($1,'METHOD','METHOD-L','F1','2026-10-01','действующий','актуальная',
      'да','годен','METHOD-REQ-VIK','2026-10-01','METHOD-CON-VIK','2026-10-02',
      'да','годен','METHOD-REQ-RK','2026-10-01','METHOD-CON-RK','2026-10-02')`, [project]))
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
})
test.afterEach(async ({ page }) => { await page.close(); await cleanupLineProgramProjects([project]) })

for (const tab of ['Заявка ЛНК', 'Заключения ЛНК']) test(`${tab}: method checkbox changes actual rows, combines choices and resets`, async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/documents')
  await page.getByRole('button', { name: tab, exact: true }).click()
  const grid = page.locator('[data-document-history-grid]')
  await grid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill('METHOD-')
  const count = (n: number) => expect(grid.getByText(`Найдено: ${n}`, { exact: true })).toBeVisible()
  const methods = grid.locator('.ag-row:not(.ag-opacity-zero) .ag-cell[col-id="method"]')
  await count(2)
  let filter = await openDocumentGridFilter(page, 'method', 'Вид НК')
  await filter.getByRole('checkbox', { name: /^РК/ }).check()
  await count(1)
  await expect(methods).toHaveText(['РК'])
  await filter.getByRole('checkbox', { name: /^ВИК/ }).check()
  await count(2)
  await filter.getByRole('checkbox', { name: /^РК/ }).uncheck()
  await count(1)
  await expect(methods).toHaveText(['ВИК'])
  await filter.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: tab, exact: true }).click()
  await count(1)
  await expect(methods).toHaveText(['ВИК'])
  filter = await openDocumentGridFilter(page, 'method', 'Вид НК')
  await expect(filter.getByRole('checkbox', { name: /^ВИК/ })).toBeChecked()
  await filter.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
  await count(2)
  await filter.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
  if (tab === 'Заключения ЛНК') {
    await page.getByRole('tab', { name: /^РК\s/ }).click()
    await count(1)
    await expect(methods).toHaveText(['РК'])
    filter = await openDocumentGridFilter(page, 'method', 'Вид НК')
    await filter.getByRole('checkbox', { name: /^ВИК/ }).check()
    await count(1)
    await expect(methods).toHaveText(['ВИК'])
    await filter.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
  }
  await page.screenshot({ path: info.outputPath('method-filter.png') })
  expect(errors).toEqual([])
})
