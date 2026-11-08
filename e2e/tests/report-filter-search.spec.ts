import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E complete report filter search'
test.beforeAll(async () => {
  await withLineProgramFixture(db => db.query(`insert into weld_joints
    (project_title, subtitle_code, line, joint, weld_date, connection_type, officiality, revision_actuality, has_vik, psto_required)
    select $1,'SEARCH','FIND-L-'||lpad(n::text,4,'0'),'F'||n,'2026-11-01','С17','действующий','актуальная','да','да'
    from generate_series(1,1101) n`, [project]))
})
test.afterAll(() => cleanupLineProgramProjects([project]))

for (const route of ['/journal', '/lnk', '/psto']) test(`${route}: filter search includes values beyond the first 1000 and preserves complete Select Found`, async ({ page }) => {
  let reads = 0
  page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalFilterPage_')) reads++ })
  await page.goto(route)
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(page.getByText('Найдено: 1101', { exact: true })).toBeVisible()
  await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  const dialog = page.getByRole('dialog', { name: 'Фильтр: Линия' })
  const search = dialog.getByLabel('Найти значение фильтра')
  await expect(dialog.getByRole('checkbox', { name: /FIND-L-0001/ })).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: /FIND-L-1101/ })).toHaveCount(0)
  const firstPageSize = await dialog.getByRole('checkbox').count()
  const initialReads = reads
  await search.fill('FIND-L-1101')
  await expect(dialog.getByRole('checkbox', { name: /FIND-L-1101/ })).toBeVisible()
  expect(reads).toBeGreaterThan(initialReads)
  await search.fill('DOES-NOT-EXIST')
  await search.fill('FIND-L-110')
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await expect(dialog.getByRole('checkbox', { name: /FIND-L-1100/ })).toBeVisible()
  await dialog.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: /FIND-L-1100/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /FIND-L-1101/ })).toBeChecked()
  await expect(search).toBeFocused()
  await dialog.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
  await expect(page.getByText('Найдено: 1101', { exact: true })).toBeVisible()
  await search.fill('')
  await expect(dialog.getByRole('button', { name: /Ещё значения/ })).toBeVisible()
  await dialog.getByRole('button', { name: /Ещё значения/ }).click()
  await expect.poll(() => dialog.getByRole('checkbox').count()).toBeGreaterThan(firstPageSize)
  await expect(search).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(reads).toBeLessThanOrEqual(6)
})
