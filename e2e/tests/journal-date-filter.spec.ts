import { expect, test, type Page } from '@playwright/test'
import { assertSafeE2eDatabaseUrl } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { revealJournalColumn } from '../journal-grid'
import { rpcName } from '../rpc'

const PROJECT = 'E2E journal date hierarchy'
const diagnostics = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  await cleanupLineProgramProjects([PROJECT])
  await withLineProgramFixture(db => db.query(`
    insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,created_at,
      officiality,revision_actuality,has_vik,connection_type)
    values
      ($1,'DATE','DATE-L1','DATE-1','2025-12-31','2025-12-31T10:00:00Z','действующий','актуальная','да','С17'),
      ($1,'DATE','DATE-L1','DATE-2','2026-09-30','2026-09-30T10:00:00Z','действующий','актуальная','да','С17'),
      ($1,'DATE','DATE-L1','DATE-3','2026-10-01','2026-10-01T21:10:00.001Z','действующий','актуальная','да','С17'),
      ($1,'DATE','DATE-L1','DATE-4','2026-10-02','2026-10-01T21:10:00.002Z','действующий','актуальная','да','С17'),
      ($1,'DATE','DATE-L1','DATE-5',null,'2026-10-02T10:00:00Z','действующий','актуальная','да','С17')
  `, [PROJECT]))
  const errors: string[] = []
  diagnostics.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  // Match the existing journal gate; the separate trial-license banner is not a runtime error.
  page.on('console', message => { if (['warning', 'error'].includes(message.type()) && /AG Grid:/.test(message.text())) errors.push(message.text()) })
})

test.afterEach(async ({ page }) => {
  await cleanupLineProgramProjects([PROJECT])
  expect(diagnostics.get(page) ?? []).toEqual([])
})

async function openJournal(page: Page) {
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
  await expect(page.getByText('Найдено: 5', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида журнала', exact: true })
  const showAll = settings.getByRole('button', { name: 'Показать все', exact: true })
  if (await showAll.isVisible()) await showAll.click()
  await expect(settings.getByRole('button', { name: 'Скрыть все', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
}

async function openFilter(page: Page, field: string, label: string) {
  await revealJournalColumn(page, field)
  await page.locator(`.ag-header-cell[col-id="${field}"] .ag-header-cell-filter-button`).click()
  const filter = page.getByRole('dialog', { name: `Фильтр: ${label}`, exact: true })
  await expect(filter).toBeVisible()
  return filter
}

test('journal dates: year/month/day selection, hidden search choices, reopen and reset preserve full-query facets', async ({ page }) => {
  const calls: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  const facetCalls = () => calls.filter(name => name.startsWith('listJournalFilterOptions_')).length
  await openJournal(page)
  const filter = await openFilter(page, 'weldDate', 'Дата сварки')
  await expect(filter.getByRole('checkbox', { name: 'Год 2026', exact: true })).toBeVisible()
  await expect(filter.getByRole('checkbox', { name: 'Год 2025', exact: true })).toBeVisible()
  expect(facetCalls()).toBe(1)
  await filter.getByRole('checkbox', { name: 'Год 2026', exact: true }).check()
  await expect(page.getByText('Найдено: 3', { exact: true })).toBeVisible()
  await filter.getByRole('button', { name: 'Развернуть Год 2026', exact: true }).click()
  await filter.getByRole('checkbox', { name: 'Сентябрь 2026', exact: true }).uncheck()
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  await filter.getByRole('button', { name: 'Развернуть Октябрь 2026', exact: true }).click()
  await filter.getByRole('checkbox', { name: 'День 01.10.2026', exact: true }).uncheck()
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(filter.getByRole('checkbox', { name: 'День 02.10.2026', exact: true })).toBeChecked()
  expect(facetCalls()).toBe(1)
  await filter.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()

  const reopened = await openFilter(page, 'weldDate', 'Дата сварки')
  await reopened.getByLabel('Найти значение фильтра').fill('2025')
  await reopened.getByRole('checkbox', { name: 'Год 2025', exact: true }).check()
  // The already selected October day is hidden by search, but remains selected.
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  await reopened.getByLabel('Найти значение фильтра').fill('')
  await reopened.getByRole('button', { name: 'Развернуть Год 2026', exact: true }).click()
  await reopened.getByRole('button', { name: 'Развернуть Октябрь 2026', exact: true }).click()
  await expect(reopened.getByRole('checkbox', { name: 'День 02.10.2026', exact: true })).toBeChecked()
  await expect(reopened.getByRole('checkbox', { name: 'День 01.10.2026', exact: true })).not.toBeChecked()
  await reopened.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
  await expect(reopened.getByLabel('Найти значение фильтра')).toBeFocused()
  await expect(page.getByText('Найдено: 5', { exact: true })).toBeVisible()
  await reopened.getByRole('checkbox', { name: /пусто/i }).check()
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await reopened.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
  await expect(page.getByText('Найдено: 5', { exact: true })).toBeVisible()
  expect(facetCalls()).toBeLessThanOrEqual(2) // Reopen may refresh the same facet after its cache expires.
  await page.keyboard.press('Escape')
  await expect(reopened).toBeHidden()
})

test('journal timestamps: a Moscow day retains both millisecond values and allows a distinct time leaf', async ({ page }) => {
  await openJournal(page)
  const filter = await openFilter(page, 'createdAt', 'Внесен сварка')
  await filter.getByRole('button', { name: 'Развернуть Год 2026', exact: true }).click()
  await filter.getByRole('button', { name: 'Развернуть Октябрь 2026', exact: true }).click()
  await expect(filter.getByRole('checkbox', { name: 'День 01.10.2026', exact: true })).toHaveCount(0)
  await filter.getByRole('checkbox', { name: 'День 02.10.2026', exact: true }).check()
  await expect(page.getByText('Найдено: 3', { exact: true })).toBeVisible()
  await filter.getByRole('button', { name: 'Развернуть День 02.10.2026', exact: true }).click()
  await filter.getByRole('checkbox', { name: /02\.10\.26 13:00:00/ }).uncheck()
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  await expect(filter.getByRole('checkbox', { name: /02\.10\.26 00:10:00/ })).toBeChecked()
  await page.keyboard.press('Escape')
  const reopened = await openFilter(page, 'createdAt', 'Внесен сварка')
  await reopened.getByLabel('Найти значение фильтра').fill('00:10:00')
  await expect(reopened.getByRole('checkbox', { name: /02\.10\.26 00:10:00/ })).toBeChecked()
  await reopened.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  await reopened.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
  await expect(page.getByText('Найдено: 5', { exact: true })).toBeVisible()
  await expect(reopened.getByLabel('Найти значение фильтра')).toHaveValue('')
})
