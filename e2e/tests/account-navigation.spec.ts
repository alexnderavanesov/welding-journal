import { expect, test, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { editJournalJoint } from '../journal-grid'
import { rpcName } from '../rpc'

const project = 'E2E account navigation freshness'
const search = (page: Page) => page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })
const report = (page: Page) => page.locator('[data-weld-report-grid="weldingJournal"] .journal-grid-frame')
test.afterEach(() => cleanupLineProgramProjects([project]))

test('account sidebar keeps one document, access, history and fresh journal data after another window saves', async ({ page, browser }, info) => {
  test.setTimeout(120000)
  const id = await withLineProgramFixture(async db => (await db.query(`
    insert into weld_joints(project_title,subtitle_code,line,joint,isometry,connection_type,weld_date,officiality,revision_actuality)
    values($1,'ACCOUNT','ACCOUNT-L','F991001','BEFORE','С17','2026-10-01','действующий','актуальная') returning id`, [project])).rows[0].id as number)
  const writerContext = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL })
  const errors: string[] = [], documents: string[] = [], rpc: string[] = []
  const elapsed: Record<string, number> = {}, origins: Record<string, number> = {}
  let timeOrigin = 0
  page.on('pageerror', error => errors.push(error.message))
  try {
    const writer = await writerContext.newPage()
    await writer.goto('/journal')
    await search(writer).fill(project)
    await expect(writer.getByText('Найдено: 1', { exact: true })).toBeVisible()
    await page.goto('/account?tab=profile')
    await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
    const name = await page.getByLabel('Фамилия и имя', { exact: true }).inputValue()
    timeOrigin = await page.evaluate(() => performance.timeOrigin)
    page.on('request', request => {
      if (request.isNavigationRequest() && request.resourceType() === 'document') documents.push(request.url())
      if (request.url().includes('/_serverFn/')) rpc.push(rpcName(request.url()))
    })
    let start = Date.now()
    await page.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: 'Сварочный журнал', exact: true }).click()
    await expect(page).toHaveURL(/\/journal$/)
    await expect(search(page)).toBeVisible()
    await expect(report(page)).toHaveAttribute('aria-busy', 'false')
    elapsed.open = Date.now() - start
    origins.open = await page.evaluate(() => performance.timeOrigin)
    expect.soft(origins.open).toBe(timeOrigin)
    await search(page).fill(project)
    await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
    start = Date.now()
    await page.goBack()
    await expect(page).toHaveURL(/\/account\?tab=profile$/)
    await expect(page.getByLabel('Фамилия и имя', { exact: true })).toHaveValue(name)
    await expect(page.getByRole('tab', { name: 'Пользователи и права', exact: true })).toBeVisible()
    elapsed.back = Date.now() - start
    origins.back = await page.evaluate(() => performance.timeOrigin)
    expect.soft(origins.back).toBe(timeOrigin)

    // Save through the actual UI while the first window is outside the report.
    // A same-document return is useful only if its warm cache stays current.
    await writer.bringToFront()
    await editJournalJoint(writer, id)
    const dialog = writer.getByRole('dialog').filter({ has: writer.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
    await dialog.getByLabel('Изометрия', { exact: true }).fill('FRESH-AFTER-ACCOUNT')
    await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(report(writer)).toHaveAttribute('aria-busy', 'false')
    expect(await withE2eDatabase(async db => (await db.query('select isometry from weld_joints where id=$1', [id])).rows[0].isometry)).toBe('FRESH-AFTER-ACCOUNT')
    await page.bringToFront()
    start = Date.now()
    await page.goForward()
    await expect(page).toHaveURL(/\/journal$/)
    await expect(search(page)).toHaveValue(project)
    await expect(report(page)).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
    const viewport = report(page).locator('.ag-grid-viewport')
    const isometry = report(page).locator('.ag-header-cell[col-id="isometry"]')
    const steps = await viewport.evaluate(element => Math.ceil(element.scrollWidth / Math.max(100, element.clientWidth / 2)) + 1)
    for (let step = 0; step < steps && !await isometry.count(); step++) await viewport.evaluate(async element => {
      element.scrollLeft += Math.max(100, element.clientWidth / 2)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    await isometry.scrollIntoViewIfNeeded()
    await expect(report(page).locator(`.ag-row[row-id="${id}"] [col-id="isometry"]`)).toHaveText('FRESH-AFTER-ACCOUNT')
    await expect(page.getByRole('button', { name: 'Обновить таблицу', exact: true })).toBeHidden()
    elapsed.forwardFresh = Date.now() - start
    origins.forward = await page.evaluate(() => performance.timeOrigin)
    expect.soft(origins.forward).toBe(timeOrigin)
    expect(documents).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await info.attach('account-navigation', { contentType: 'application/json', body: JSON.stringify({ timeOrigin, origins, elapsed, documents, rpc, errors }) })
    await writerContext.close()
  }
})
