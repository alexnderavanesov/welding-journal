import { expect, test } from '@playwright/test'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { duplicateControls, preHeatTreatmentControls, weldJoints } from '../../src/db/schema'
import { LNK_METHODS } from '../../src/lib/report-config'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { DEFAULT_OTHER_SETTINGS } from '../../src/lib/other-settings'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { getLnkDisplayValue } from '../../src/lib/lnk-status'
import { prepareJournalPageRows } from '../../src/lib/use-report-rows'
import { buildReportQueryWhere, listColumnFilterOptions, listReportPage, normalizeWeldColumnFilterOptionsRequest, normalizeWeldPageRequest } from '../../src/server/weld-read'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { assertSafeE2eDatabaseUrl } from '../database'
import { revealJournalColumn } from '../journal-grid'

const PROJECT = 'E2E result display filter'
const projects = LNK_METHODS.map(method => `${PROJECT} ${method.code}`)
// Expected operator-visible values, independently of SQL/display helpers.
const cases = [
  ['main-reject', 'нет потребности'],
  ['duplicate-reject', 'нет потребности'],
  ['pre-reject', 'нет потребности'],
  ['additional-request', 'ожидает НК'],
  ['request', 'ожидает НК'],
  ['no-request', 'ожидает заявку'],
  ['good', 'годен'],
  ['repair', 'ремонт'],
  ['cancelled', 'отменен'],
  ['cancelled-good', 'годен · назначение отменено'],
] as const

test.beforeAll(async () => {
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  await cleanupLineProgramProjects(projects)
  await withLineProgramFixture(async client => {
    const db = drizzle(client)
    for (const method of LNK_METHODS) for (const [index, [kind]] of cases.entries()) {
      const rejected = method.code === 'ВИК' ? LNK_METHODS[3] : LNK_METHODS[0]
      const [row] = await db.insert(weldJoints).values({
        projectTitle: `${PROJECT} ${method.code}`, line: `FILTER-${method.code}`, joint: `F${index + 1}`,
        weldDate: '2026-11-01', connectionType: 'С17', officiality: 'действующий', revisionActuality: 'актуальная',
        hasVik: 'да', vikResult: 'годен',
        [method.enabledKey]: kind.startsWith('cancelled') ? 'отменен' : kind === 'additional-request' ? 'дополнительный' : 'да',
        [method.resultKey]: kind.endsWith('good') ? 'годен' : kind === 'repair' ? 'ремонт' : kind === 'request' ? null : 'ожидает НК',
        [method.requestKey]: kind === 'no-request' ? null : 'Заявка',
        [rejected.enabledKey]: 'дополнительный',
        [rejected.resultKey]: ['main-reject', 'good', 'cancelled'].includes(kind) ? 'ремонт' : 'годен',
        pstoRequired: kind === 'pre-reject' ? 'да' : null,
      }).returning({ id: weldJoints.id })
      if (kind === 'duplicate-reject') await db.insert(duplicateControls).values({ weldJointId: row.id, method: rejected.code, result: 'вырез' })
      if (kind.includes('pre-reject')) await db.insert(preHeatTreatmentControls).values({ weldJointId: row.id, method: rejected.code, result: 'ремонт' })
    }
  })
  await ensureDispatcherTaskIndexFresh()
})
test.afterAll(() => cleanupLineProgramProjects(projects))

test('main result facets and selected rows use displayed states for every method', async () => {
  for (const report of ['weldingJournal', 'lnk'] as const) for (const method of LNK_METHODS) {
    const projectTitle = `${PROJECT} ${method.code}`
    const options = await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({
      report, fieldKey: method.resultKey, projectTitle, columnFilters: { [method.resultKey]: '=own filter is excluded' },
    }))
    const counts = new Map<string, number>()
    for (const [, value] of cases) counts.set(value, (counts.get(value) ?? 0) + 1)
    expect(new Map(options.map(option => [option.value, option.count])), `${report}/${method.code}`).toEqual(counts)
    for (const [value] of counts) for (const filter of [buildWeldColumnValueFilter([value]), `=${value}`]) {
      const expected = cases.flatMap(([, label], index) => label === value ? [`F${index + 1}`] : [])
      const columnFilters = { [method.resultKey]: filter }
      const selected = await requireDb().select({ joint: weldJoints.joint }).from(weldJoints)
        .where(buildReportQueryWhere(report, { projectTitle, columnFilters }, DEFAULT_OTHER_SETTINGS))
      expect(selected.map(row => row.joint).sort()).toEqual(expected.sort())
      const page = await listReportPage(report, normalizeWeldPageRequest({ projectTitle, columnFilters, includeTotals: true }))
      expect(page.total).toBe(expected.length)
      expect(page.rows.map(row => row.joint).sort()).toEqual(expected.sort())
      for (const row of prepareJournalPageRows(page.rows, report)) expect(getLnkDisplayValue(row, method.resultKey)).toBe(value)
    }
    const combined = buildReportQueryWhere(report, { projectTitle, columnFilters: {
      [method.resultKey]: buildWeldColumnValueFilter(['нет потребности', 'ожидает заявку']), joint: '=F1',
    } }, DEFAULT_OTHER_SETTINGS)
    expect(await requireDb().select({ joint: weldJoints.joint }).from(weldJoints).where(combined)).toEqual([{ joint: 'F1' }])
    // Filtering must not rewrite stored waiting labels or control history.
    const stored = await requireDb().select().from(weldJoints).where(eq(weldJoints.projectTitle, projectTitle))
    expect(stored.find(row => row.joint === 'F1')?.[method.resultKey]).toBe('ожидает НК')
  }
})

for (const [report, path] of [['weldingJournal', '/journal'], ['lnk', '/lnk']] as const) {
  test(`${report}: result filter matches cells, selects no-need and resets`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    if (report === 'lnk') await page.addInitScript(hidden => {
      localStorage.setItem('welding-report-view:v1:lnk', JSON.stringify({ activePreset: 'custom', hiddenFieldKeys: hidden,
        customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [] }))
    }, WELD_FIELDS.filter(field => !['joint', 'line', 'rkResult'].includes(field.key)).map(field => field.key))
    await page.goto(path)
    await page.getByPlaceholder('Поиск по отчету').fill(`${PROJECT} РК`)
    await expect(page.getByText('Найдено: 10', { exact: true })).toBeVisible()
    if (report === 'weldingJournal') {
      await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Настройка вида журнала', exact: true })
      const showAll = settings.getByRole('button', { name: 'Показать все', exact: true })
      if (await showAll.isVisible()) await showAll.click()
      await page.keyboard.press('Escape')
      await revealJournalColumn(page, 'rkResult')
    }
    await page.locator('.ag-header-cell[col-id="rkResult"] .ag-header-cell-filter-button').click()
    const filter = page.getByRole('dialog', { name: 'Фильтр: Результат РК', exact: true })
    const noNeed = filter.getByRole('checkbox', { name: /нет потребности/ })
    await expect(noNeed).toBeVisible()
    await noNeed.check()
    await expect(page.getByText('Найдено: 3', { exact: true })).toBeVisible()
    await filter.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
    const cells = page.locator('.ag-row:not(.ag-row-group) [col-id="rkResult"]')
    await expect(cells).toHaveCount(3)
    await expect(cells).toHaveText(['нет потребности', 'нет потребности', 'нет потребности'])
    await page.locator('.ag-header-cell[col-id="rkResult"] .ag-header-cell-filter-button').click()
    await expect(noNeed).toBeChecked()
    await filter.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
    await expect(page.getByText('Найдено: 10', { exact: true })).toBeVisible()
    await filter.getByLabel('Найти значение фильтра').fill('ожидает НК')
    await filter.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
    await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(cells).toHaveCount(2)
    await expect(cells).toHaveText(['ожидает НК', 'ожидает НК'])
    expect(errors).toEqual([])
  })
}
