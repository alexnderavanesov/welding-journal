import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'

const project = `ACCESS-REFRESH-${randomUUID()}`
test.beforeAll(async () => {
  await withE2eDatabase(db => db.query(`insert into weld_joints(project_title,line,joint,weld_date,psto_required,has_vik,officiality,revision_actuality)
    values($1,'REFRESH-LINE','F1','2026-10-01','да','да','действующий','актуальная')`, [project]))
})
test.afterAll(async () => {
  await withE2eDatabase(db => db.query('delete from weld_joints where project_title=$1', [project]))
})

for (const path of ['/journal', '/lnk', '/psto']) test(`${path}: unchanged session refresh preserves an open filter and its draft`, async ({ page }) => {
  await page.goto(path)
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Линия' })
  await filter.getByLabel('Найти значение фильтра').fill('REFRESH-LINE')
  await expect(filter.getByRole('checkbox')).toHaveCount(1)
  for (let round = 0; round < 2; round++) {
    const response = page.waitForResponse(response => response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith('refreshAccountActivity_'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await (await response).finished()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(filter).toBeVisible()
    await expect(filter.getByLabel('Найти значение фильтра')).toHaveValue('REFRESH-LINE')
  }
  await filter.getByRole('checkbox').check()
  await expect(filter).toBeVisible()
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
})
