import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { lnkActionRow } from './lnk-grid-helpers'

const project = 'E2E workflow grid stability', joint = 'F97001'
let firstId: number
test.beforeEach(async () => withLineProgramFixture(async db => {
  await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,has_vik,psto_required,connection_type,d1,t1,officiality,revision_actuality)
    select $1,'STABLE','STABLE-'||lpad(((n-1)/2)::text,4,'0'),'F'||(97000+n),'2026-09-01','да','нет','С17',108,4,'действующий','актуальная'
    from generate_series(1,2000) n`, [project])
  firstId = (await db.query('select id from weld_joints where project_title=$1 and joint=$2', [project, joint])).rows[0].id
}))
test.afterEach(() => cleanupLineProgramProjects([project]))

async function openExpanded(page: Page) {
  await page.addInitScript(() => localStorage.setItem('lnk-ag-grid:v1', JSON.stringify({ columns: [{ colId: 'line', rowGroup: true, rowGroupIndex: 0 }], views: [] })))
  await page.goto('/lnk')
  const root = page.locator('[data-weld-report-grid="lnk"]')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(root.getByText('Найдено: 2000', { exact: true })).toBeVisible()
  await expect(root.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  const group = root.locator('.ag-row-group.ag-row-level-0').filter({ hasText: 'STABLE-0000' }).first()
  await group.click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
  const row = await lnkActionRow(page, joint)
  return { root, row }
}
async function createRequest(page: Page, row: Locator) {
  await row.getByRole('button', { name: 'Выполнить: Создать заявку основного НК', exact: true }).click()
  await page.getByLabel('Дата заявки', { exact: true }).fill('2026-09-02')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК', exact: true })).toBeHidden()
  await page.getByRole('status').filter({ hasText: /Заявка.*создана для стыков/ }).getByRole('button', { name: 'Закрыть уведомление' }).click()
}

test('expanded report keeps visible rows through NK request and result saves with unloaded groups', async ({ page }, info) => {
  const errors: string[] = [], reads: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const name = rpcName(request.url()); if (/readJournalGrid/.test(name)) reads.push(name) })
  const { root, row } = await openExpanded(page)
  const original = await row.elementHandle()
  const before = reads.length
  await createRequest(page, row)
  await expect(row.getByRole('button', { name: 'Выполнить: Внести результат основного НК', exact: true })).toBeVisible()
  expect(await original!.evaluate(element => element.isConnected)).toBe(true)
  await row.getByRole('button', { name: 'Выполнить: Внести результат основного НК', exact: true }).click()
  await page.getByLabel('Дата контроля', { exact: true }).fill('2026-09-03')
  await page.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true })).toBeHidden()
  // This deliberately partial weld fixture can still have СП-03. Saving NK
  // must update its factual result without hiding unrelated dispatcher checks.
  await expect(row.getByText('годен', { exact: true })).toBeVisible()
  expect(await original!.evaluate(element => element.isConnected)).toBe(true)
  expect(reads.length - before).toBeLessThan(30)
  await withE2eDatabase(async db => expect((await db.query('select vik_request_date::text,vik_conclusion_date::text,vik_result from weld_joints where id=$1', [firstId])).rows)
    .toEqual([{ vik_request_date: '2026-09-02', vik_conclusion_date: '2026-09-03', vik_result: 'годен' }]))
  await withE2eDatabase(async db => expect((await db.query('select count(*)::int as count from weld_joints where project_title=$1 and id<>$2 and (vik_request is not null or vik_conclusion is not null)', [project, firstId])).rows[0].count).toBe(0))
  await expect(root.locator('.ag-row-group.ag-row-level-0').first()).toHaveAttribute('aria-expanded', 'true')
  const afterSaves = reads.length
  // A previously unloaded group must still load against the new revision.
  // Expand All must not turn the save into a fetch of all 1000 child stores.
  await expect.poll(async () => {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    return root.locator('.ag-row').filter({ hasText: 'F99000' }).first().isVisible()
  }).toBe(true)
  expect(reads.length - afterSaves).toBeLessThan(30)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('grid-data-reads.json'), JSON.stringify({ requestsAfterTwoSaves: afterSaves - before, requestsToUnloadedEnd: reads.length - afterSaves }))
})

test('result warning and correction controls fit the fixed footer without internal scrolling', async ({ page }, info) => {
  const { row } = await openExpanded(page)
  await createRequest(page, row)
  await row.getByRole('button', { name: 'Выполнить: Внести результат основного НК', exact: true }).click()
  await page.getByLabel('Дата контроля', { exact: true }).fill('2026-08-01')
  await page.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
  const footer = page.getByRole('group', { name: 'Сохранение результата', exact: true })
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(footer).toContainText('Сохранение заблокировано')
    await expect(footer.getByRole('button', { name: 'Сохранить результат', exact: true })).toBeDisabled()
    await expect(footer.getByRole('button', { name: 'Отмена', exact: true })).toBeInViewport()
    const area = footer.locator(':scope > div').first()
    expect(await area.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
    const top = (await footer.boundingBox())!.y
    await area.hover(); await page.mouse.wheel(0, 600)
    await expect.poll(async () => Math.abs((await footer.boundingBox())!.y - top)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath(`footer-${width}.png`) })
  }
})
