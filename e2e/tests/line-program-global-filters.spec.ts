import { expect, test, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E global program filters'
test.afterEach(() => cleanupLineProgramProjects([project]))

async function seed() {
  await withLineProgramFixture(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'GLOBAL','GLOBAL-'||lpad(n::text,3,'0'),'II','A',10,0 from generate_series(1,65) n`, [project])
    // Only the last line needs control. The first two pages legitimately contain zeroes.
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,
      officiality,revision_actuality,has_vik,vik_result,stamp_1_k)
      select id,$1,subtitle_code,line,'F1','2026-09-01','С17','действующий','актуальная','да','годен','GLOBAL-STAMP'
      from line_programs where project_title=$1 and line='GLOBAL-065'`, [project])
  })
}

async function openFilter(page: Page, name: string) {
  await page.locator('[data-program-grid="lines"]').getByRole('columnheader', { name, exact: true }).locator('.ag-header-cell-filter-button').click()
  return page.locator('.ag-filter').filter({ visible: true })
}

async function scrollToTop(page: Page) {
  await page.evaluate(async () => {
    window.scrollTo(0, 0)
    // Let the document-driven viewport follow before Playwright scrolls a
    // header into view; its old absolute position may still be at the bottom.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  await stablePagePosition(page, 0)
}

async function stablePagePosition(page: Page, expected?: number) {
  let previous = -1, samples = 0
  await expect.poll(async () => {
    const top = await page.evaluate(() => window.scrollY)
    samples = top === previous && (expected == null || top === expected) ? samples + 1 : 0
    previous = top
    return samples
  }, { intervals: [50] }).toBeGreaterThanOrEqual(3)
}

test('overview filters and numeric sorting see every line before any badge is opened', async ({ page }) => {
  await seed()
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1900, height: 1000 })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(project)
  await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Линий 65', exact: true })).toBeVisible()
  const cards = page.getByTestId('line-program-card')
  await expect(cards).toHaveCount(30)
  const before = calls.length
  const filter = await openFilter(page, 'К назначению')
  await expect(filter.getByRole('checkbox', { name: '1', exact: true })).toBeVisible()
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('checkbox', { name: '1', exact: true }).check()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(cards).toHaveCount(1)
  await expect(cards.getByTestId('line-name')).toHaveText('GLOBAL-065')
  await expect(page.getByText('1–1 из 1 линий', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Сводка по линиям', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
  await expect(preview.frameLocator('iframe').locator('tbody tr')).toHaveCount(1)
  await expect(preview.frameLocator('iframe').getByText('GLOBAL-065', { exact: true })).toBeVisible()
  await preview.frameLocator('iframe').locator('body').press('Escape')
  const reset = await openFilter(page, 'К назначению')
  await reset.getByRole('button', { name: 'Сбросить', exact: true }).click()
  if (await reset.isVisible()) await reset.press('Escape')
  const header = page.locator('[data-program-grid="lines"]').getByRole('columnheader', { name: 'К назначению', exact: true })
  await header.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
  await expect(cards.first().getByTestId('line-name')).toHaveText('GLOBAL-065')
  await page.getByRole('button', { name: 'Страница 3', exact: true }).click()
  await expect(cards).toHaveCount(5)
  const names = await openFilter(page, 'Линия')
  await names.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await names.getByRole('textbox').fill('GLOBAL-001')
  await names.getByRole('checkbox', { name: 'GLOBAL-001', exact: true }).check()
  await names.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(cards).toHaveCount(1)
  await expect(cards.getByTestId('line-name')).toHaveText('GLOBAL-001')
  expect(calls.slice(before).filter(name => /^getLineProgram(Page|Section|Calculation|JointPage)_/.test(name))).toEqual([])
  expect(errors).toEqual([])
})

test('an unconfigured line is blank, not a calculated zero in the metric filters', async ({ page }) => {
  await seed()
  await withLineProgramFixture(db => db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent)
    values ($1,'GLOBAL','GLOBAL-UNCONFIGURED','II','A',10)`, [project]))
  await page.setViewportSize({ width: 1900, height: 1000 })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(project)
  await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Линий 66', exact: true })).toBeVisible()
  const filter = await openFilter(page, 'К назначению')
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('checkbox', { name: '(Пусто)', exact: true }).check()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(page.getByTestId('line-program-card')).toHaveCount(1)
  await expect(page.getByTestId('line-program-card').getByTestId('line-name')).toHaveText('GLOBAL-UNCONFIGURED')
})

test('grouping keeps complete filter values in the shared page scroll', async ({ page }) => {
  await seed()
  await page.setViewportSize({ width: 1900, height: 1000 })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(project)
  await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Линий 65', exact: true })).toBeVisible()
  await page.locator('[data-program-grid="lines"]').getByRole('columnheader', { name: 'Линия', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Группировать по «Линия»', exact: true }).click()
  await expect(page.locator('[data-program-grid="lines"]')).toHaveAttribute('data-program-page-scroll', 'true')
  await expect(page.getByRole('button', { name: 'Страница 2', exact: true })).toHaveCount(0)
  const filter = await openFilter(page, 'К назначению')
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('checkbox', { name: '1', exact: true }).check()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(page.getByTestId('line-program-card')).toHaveCount(1)
  // Grouping hides the source column; identify the leaf independently of it.
  await expect(page.getByTestId('line-program-card')).toHaveAttribute('data-line', 'GLOBAL-065')
  await expect(page.getByRole('gridcell', { name: 'Линия: GLOBAL-065 Линий: 1', exact: true })).toBeVisible()
  await expect(page.locator('[data-program-grid="lines"]')).toHaveAttribute('data-program-row-count', '2')
})

test('one large group has bounded DOM, complete sorting/filtering and working nested details', async ({ page }) => {
  await withLineProgramFixture(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'GLOBAL','WIDE-'||lpad(n::text,4,'0'),'II','A',case when n=1001 then 10 else 0 end,0
      from generate_series(1,1001) n`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,
      officiality,revision_actuality,has_vik,vik_result,stamp_1_k)
      select id,$1,subtitle_code,line,'F1','2026-09-01','С17','действующий','актуальная','да','годен','WIDE-STAMP'
      from line_programs where project_title=$1 and line in ('WIDE-1000','WIDE-1001')`, [project])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1900, height: 1000 })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(project)
  await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Линий 1001', exact: true })).toBeVisible()
  const grid = page.locator('[data-program-grid="lines"]'), cards = page.getByTestId('line-program-card')
  const before = calls.length
  await grid.getByRole('columnheader', { name: 'К назначению', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Группировать по «К назначению»', exact: true }).click()
  // Native master-row pagination used to render all 1000 children of this group.
  await expect.poll(() => cards.count()).toBeLessThan(80)
  await expect(grid).toHaveAttribute('data-program-row-count', '1003')
  await expect(grid.getByText('Линий: 1000', { exact: true })).toBeVisible()
  await expect(grid.getByRole('button', { name: 'Убрать группировку К назначению', exact: true })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const last = cards.filter({ has: page.getByTestId('line-name').filter({ hasText: /^WIDE-1000$/ }) })
  await expect(last).toBeVisible()
  await expect.poll(() => cards.count()).toBeLessThan(80)
  expect(calls.slice(before).filter(name => /^getLineProgram(Page|Section|Calculation|JointPage)_/.test(name))).toEqual([])
  await last.getByRole('button', { name: 'Расчёт линии WIDE-1000', exact: true }).click()
  const stampButton = page.getByRole('button', { name: 'Клеймо WIDE-STAMP', exact: true })
  await stampButton.click()
  await expect(page.getByTestId('line-program-detail').getByRole('button', { name: 'F1', exact: true })).toBeVisible()
  await expect.poll(() => cards.count()).toBeLessThan(80)
  // A mouse click need not focus a native button in WebKit/macOS. Establish
  // and verify focus before exercising its preservation through virtualization.
  await stampButton.focus()
  await expect(stampButton).toBeFocused()
  await scrollToTop(page)
  await expect(stampButton).toBeFocused()
  // A real wheel gesture must not be undone by moving the retained focused
  // detail while new virtual siblings are placed in their reading order.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(stampButton).toBeInViewport()
  await page.mouse.wheel(0, -100000)
  await stablePagePosition(page, 0)
  await expect(stampButton).toBeFocused()
  await page.keyboard.press('Home')
  const firstGroup = grid.locator('.ag-full-width-row[row-index="0"]')
  await expect(firstGroup).toBeFocused()
  await stablePagePosition(page)
  await expect(firstGroup).toBeInViewport()
  await scrollToTop(page)
  await grid.getByRole('columnheader', { name: 'Линия', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
  await scrollToTop(page)
  // The group is row 0; the expanded line is 1 and its detail occupies 2.
  // AG may retain DOM nodes in a different order from the sorted row model.
  const sortedFirst = grid.locator('[data-testid="line-program-card"][row-index="1"]')
  await expect(sortedFirst).toHaveAttribute('data-line', 'WIDE-1000')
  await expect(sortedFirst).toBeInViewport()
  await expect(grid.locator('[data-testid="line-program-card"][row-index="3"]')).toHaveAttribute('data-line', 'WIDE-0999')
  const filter = await openFilter(page, 'Линия')
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('textbox').fill('WIDE-1001')
  await filter.getByRole('checkbox', { name: 'WIDE-1001', exact: true }).check()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAttribute('data-line', 'WIDE-1001')
  await expect(grid).toHaveAttribute('data-program-row-count', '2')
  const reset = await openFilter(page, 'Линия')
  await reset.getByRole('button', { name: 'Сбросить', exact: true }).click()
  if (await reset.isVisible()) await reset.press('Escape')
  await grid.getByRole('button', { name: 'Убрать группировку К назначению', exact: true }).click()
  await expect(grid).not.toHaveAttribute('data-program-page-scroll', 'true')
  await expect(cards).toHaveCount(30)
  await expect(page.getByText('1–30 из 1001 линий', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Страница 34', exact: true }).click()
  await expect(cards).toHaveCount(11)
  expect(errors).toEqual([])
})

test('an already opened filter receives the full values when the section finishes loading', async ({ page }) => {
  await seed()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('getLineProgramSection_')) await gate
    await route.continue().catch(() => {})
  })
  try {
    await page.setViewportSize({ width: 1900, height: 1000 })
    await page.goto('/line-program')
    await expect(page.getByTestId('line-program-card')).toHaveCount(30)
    await page.locator('[data-program-grid="lines"]').getByRole('columnheader', { name: 'К назначению', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
    const filter = await openFilter(page, 'К назначению')
    await expect(page.getByText('Рассчитываем значения по всем линиям…', { exact: true })).toBeVisible()
    await expect(filter.getByRole('checkbox').filter({ visible: true })).toHaveCount(0)
    release()
    await expect(filter.getByRole('checkbox', { name: '1', exact: true })).toBeVisible()
    await expect(page.getByTestId('line-program-card').first().getByTestId('line-name')).toHaveText('GLOBAL-065')
    await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
    await filter.getByRole('checkbox', { name: '1', exact: true }).check()
    await filter.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(page.getByTestId('line-program-card').getByTestId('line-name')).toHaveText('GLOBAL-065')
  } finally { release(); await page.close() }
})
