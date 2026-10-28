import { expect, test, type Page } from '@playwright/test'
import { observeGridResults } from './grid-result-motion'
import { withE2eDatabase } from './database'
import { withLineProgramFixture } from './line-program-fixtures'
import { deserializeRpcPayload, rpcName } from './rpc'

async function revealColumn(page: Page, field: string) {
  const viewport = page.locator('.ag-grid-viewport')
  await viewport.evaluate(element => { element.scrollLeft = 0 })
  // Let column virtualisation discard the previous viewport before resolving a locator.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  for (let step = 0; step < 40; step++) {
    const header = page.locator(`.ag-header-cell[col-id="${field}"]`)
    if (await header.count()) { await header.scrollIntoViewIfNeeded(); return }
    await viewport.evaluate(element => { element.scrollLeft += 650 })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  }
  throw new Error(`Столбец ${field} не найден`)
}

async function showAllColumns(page: Page) {
  const button = page.getByRole('button', { name: 'Показать все', exact: true })
  if (await button.count()) await button.click()
}

// AG keeps outgoing rows during its native movement animation. A loaded footer
// reflects the new data immediately; wait for the old row-index copies to leave
// before targeting a single cell, without removing or sleeping through motion.
async function waitForGridRows(page: Page) {
  await expect.poll(() => page.locator('.ag-grid-scrolling-rows .ag-row[row-index]').evaluateAll(rows => {
    const indices = rows.map(row => row.getAttribute('row-index'))
    return indices.length === new Set(indices).size
  })).toBe(true)
}

type GridReport = 'weldingJournal' | 'heatTreatment' | 'lnk'

const PROFILES = {
  weldingJournal: { prefix: 'AG журнал', project: 'E2E AG journal', route: '/journal', grid: '[data-welding-journal-grid]',
    settingsLabel: 'Настройка вида журнала', storageKey: 'welding-journal-ag-grid:v1', pageRpc: 'readJournalGrid',
    accumulatedProject: 'E2E AG accumulated rows' },
  lnk: { prefix: 'AG ЛНК', project: 'E2E AG lnk', route: '/lnk', grid: '[data-lnk-grid]',
    settingsLabel: 'Настройка вида ЛНК', storageKey: 'lnk-ag-grid:v1', pageRpc: 'readJournalGrid',
    accumulatedProject: 'E2E AG accumulated LNK rows' },
  heatTreatment: { prefix: 'AG ПСТО', project: 'E2E AG psto', route: '/psto', grid: '[data-psto-grid]',
    settingsLabel: 'Настройка вида ПСТО и ТВМТ', storageKey: 'psto-ag-grid:v1', pageRpc: 'readJournalGrid',
    accumulatedProject: 'E2E AG accumulated PSTO rows' },
} as const

/** Both reports must meet the same interaction/performance contract. The journal
 * remains the baseline; only its actual profile differences are parameterized.
 * Register from separate spec files so fixtures and retained artifacts stay apart.
 */
export function registerWeldGridContract(report: GridReport) {
  const profile = PROFILES[report]
  const isPsto = report === 'heatTreatment'
  const isWorkflow = report !== 'weldingJournal'
  const noteField = isPsto ? 'pstoNote' : 'lnkNote'
  const PROJECT = profile.project
  const editHeading = isWorkflow ? isPsto ? 'Примечание ПСТО' : 'Примечание ЛНК' : 'Редактирование стыка'
  const loaded = (_visible: number, total: number) => `Найдено: ${total}`
  const groupLabel = (field: string) => `Сгруппировать по «${field}»`
  const name = (description: string) => `${profile.prefix}: ${description}`

  test.beforeEach(async ({ page }) => {
    const diagnostics: string[] = []
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type()) && /AG Grid:/.test(message.text())) diagnostics.push(message.text())
    })
    page.on('pageerror', error => diagnostics.push(error.message))
    Object.assign(page, { gridDiagnostics: diagnostics })
  })
  test.afterEach(async ({ page }) => {
    expect((page as Page & { gridDiagnostics: string[] }).gridDiagnostics).toEqual([])
  })
  test.beforeAll(async () => {
    await withLineProgramFixture(client => client.query(`
      insert into weld_joints (project_title, subtitle_code, line, joint, weld_date, connection_type,
        officiality, revision_actuality, has_vik, stamp_1_k, d1, t1, wdi,
        element_1, element_2, material_1, material_2, welding_method, material_group, responsible, isometry, spool, psto_required)
      select $1, 'AG', 'AG-' || lpad(n::text, 4, '0'), 'F' || (2000+n), '2026-09-01', 'С17',
        'действующий', 'актуальная', 'да', 'K1', 215, 10.25, 45.6,
        'Труба', 'Отвод 90°', '12Х18Н10Т', '12Х18Н10Т', 'РАД', 'М11', 'Ответственный за сварку', 'ISO-AG-2026-' || n, 'SPL-' || n, $2
        from generate_series(1,250) n where not exists (select 1 from weld_joints where project_title = $1)
    `, [PROJECT, isPsto ? 'да' : null]))
  })
  test.afterAll(async () => {
    // PSTO runs before the general report specs. Its 5000-row performance
    // fixture must not change their first page, facets or print-limit scope.
    await withLineProgramFixture(async client => {
      const projects = [PROJECT, profile.accumulatedProject]
      await client.query(`delete from weld_joint_program_states s using weld_joints w
        where s.weld_joint_id=w.id and w.project_title=any($1::text[])`, [projects])
      await client.query('delete from weld_joints where project_title=any($1::text[])', [projects])
    })
  })

  test(name('серверный поиск, фильтр всей выборки, ограниченная загрузка и виртуализация'), async ({ page }) => {
    const calls: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const pageRequests: Array<{ search?: string; page?: number; start?: number; columnFilters?: Record<string, string> }> = []
    page.on('request', request => {
      const name = rpcName(request.url())
      if (name) calls.push(name)
      if (name.startsWith(profile.pageRpc + '_')) {
        const payload = request.postData() ?? new URL(request.url()).searchParams.get('payload')
        if (!payload) throw new Error('Missing report page request payload')
        pageRequests.push((deserializeRpcPayload(payload) as { data: { search?: string; page?: number } }).data)
      }
    })
    const count = (name: string) => calls.filter(value => value.startsWith(name + '_')).length
    await page.goto(profile.route)
    await expect(page.locator(`${profile.grid} .ag-root`)).toBeVisible()
    await expect(page.locator(`${profile.grid} .journal-loaded-count`)).toHaveText(/Найдено: \d+/)
    // The fixture starts a real dispatcher publication. Do not classify its
    // late, legitimate page refresh as a request caused by the next search.
    await expect.poll(() => withE2eDatabase(async db => (await db.query(
      'select source_revision=computed_revision as fresh from dispatcher_task_index_state where id=1',
    )).rows[0]?.fresh), { timeout: 10_000 }).toBe(true)
    await page.waitForLoadState('networkidle')
    // Startup can publish the dispatcher revision once and refresh the first page.
    // The grid itself must neither request facets nor drain subsequent pages.
    const initialPages = count(profile.pageRpc)
    expect(initialPages).toBeLessThanOrEqual(2)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.waitForLoadState('networkidle')
    expect(count('readJournalFilterPage')).toBe(0)
    // A dispatcher publication may finish after networkidle and refresh the old,
    // unfiltered scope while the operator types. Inspect actual request scopes:
    // still at most two startup reads and exactly one read for this search.
    const startupPages = pageRequests.filter(request => !(request.search ?? request.columnFilters?.search))
    expect(startupPages.length).toBeLessThanOrEqual(2)
    expect(startupPages.every(request => request.start === 0)).toBe(true)
    expect(pageRequests.filter(request => (request.search ?? request.columnFilters?.search) === PROJECT)).toHaveLength(1)
    expect(pageRequests).toHaveLength(startupPages.length + 1)
    expect(await page.locator('.ag-grid-scrolling-rows .ag-row').count()).toBeGreaterThan(5)
    expect(await page.locator('.ag-grid-scrolling-rows .ag-row').count()).toBeLessThan(60)
    expect(await page.locator('.ag-grid-scrolling-rows .ag-cell').count()).toBeLessThan(1500)
    const beforeFocus = [...calls]
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    await page.waitForLoadState('networkidle')
    expect(calls).toEqual(beforeFocus)
    await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
    const filter = page.getByRole('dialog', { name: 'Фильтр: Линия' })
    await filter.getByLabel('Найти значение фильтра').fill('AG-0250')
    await expect(filter.getByRole('checkbox')).toHaveCount(1)
    await filter.getByRole('checkbox').check()
    await expect.poll(() => filter.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await expect(page.getByText(loaded(1, 1), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await expect(page.getByRole('button', { name: 'F2250', exact: true })).toBeVisible()
    await expect(filter).toBeVisible()
    expect(count('readJournalFilterPage')).toBe(1)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Сбросить', exact: true }).click()
    await expect(page.getByText(/Найдено:/)).toBeVisible()
    await waitForGridRows(page)
    expect(errors).toEqual([])
  })

  test(name('родная картина стыка, ПКМ с иконками, таблица ЛНК и AG Grid ПСТО'), async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(profile.route)
    const jointName = isWorkflow ? 'F2001' : 'F1'
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(isWorkflow ? PROJECT : 'E2E проект')
    const joint = page.getByRole('button', { name: jointName, exact: true })
    await expect(joint).toBeVisible()
    await joint.click()
    const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Картина стыка ${jointName}`, exact: true }) })
    await expect(picture).toBeVisible()
    await expect(picture.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
    await expect(picture.locator('aside')).toBeVisible()
    const box = (await picture.boundingBox())!
    expect(box.width).toBeGreaterThan(1000)
    await picture.getByRole('tab', { name: /Картина линии/ }).click()
    expect(await picture.boundingBox()).toEqual(box)
    await picture.getByRole('tab', { name: 'Стык', exact: true }).click()
    expect(await picture.boundingBox()).toEqual(box)
    await picture.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await joint.click({ button: 'right' })
    await expect(page.getByRole('button', { name: 'Картина стыка', exact: true }).locator('svg')).toBeVisible()
    if (isWorkflow) {
      await expect(page.getByRole('button', { name: 'Редактировать стык', exact: true })).toHaveCount(0)
      if (isPsto) await expect(page.getByRole('button', { name: 'История циклов ПСТО/ТВМТ', exact: true })).toBeVisible()
      else await expect(page.getByRole('button', { name: 'Официальность', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await revealColumn(page, '__actions')
      const actions = page.locator('.ag-row[row-index="0"] [col-id="__actions"]')
      await expect(actions.getByRole('button', { name: isPsto ? 'Создать заявку ПСТО на этот стык' : 'Создать заявку ЛНК на этот стык', exact: true })).toBeVisible()
      await expect(actions.getByRole('button', { name: isPsto ? 'Добавить результат ПСТО на этот стык' : 'Добавить результат ЛНК на этот стык', exact: true })).toBeVisible()
      await expect(actions.getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0)
      await expect(actions.getByRole('button', { name: 'Удалить', exact: true })).toHaveCount(0)
    } else {
      await page.getByRole('button', { name: 'Редактировать стык', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
    }
    await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'ЛНК', exact: true }).click()
    await expect(page.locator('[data-lnk-grid] .ag-root')).toBeVisible()
    await page.getByRole('button', { name: 'ПСТО и ТВМТ', exact: true }).click()
    await expect(page.locator('[data-welding-journal-grid]')).toHaveCount(0)
    await expect(page.locator('[data-psto-grid] .ag-root')).toBeVisible()
    expect(errors).toEqual([])
  })

  test(name('оформление и сохранённые виды без потери фильтра'), async ({ page }) => {
    await page.goto(profile.route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
    const appearance = page.getByRole('dialog', { name: profile.settingsLabel })
    await appearance.getByRole('combobox', { name: 'Плотность строк' }).click()
    await appearance.getByRole('option', { name: /Компактно/ }).click()
    await appearance.getByRole('switch', { name: 'Вертикальная сетка' }).check()
    await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
    await page.getByRole('tab', { name: 'Столбцы', exact: true }).click()
    await page.getByRole('dialog', { name: profile.settingsLabel }).getByRole('checkbox', { name: 'Следующий шаг' }).uncheck()
    await page.getByRole('tab', { name: 'Столбцы', exact: true }).click()
    await page.getByRole('tab', { name: 'Мои виды', exact: true }).click()
    const views = page.getByRole('dialog', { name: profile.settingsLabel })
    await views.getByPlaceholder('Название вида').fill('Моя смена')
    await views.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(page.locator('.journal-density-compact')).toBeVisible()
    await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    await page.getByRole('tab', { name: 'Мои виды', exact: true }).click()
    await page.getByRole('button', { name: /^Моя смена/ }).click()
    await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })).toHaveValue(PROJECT)
    await page.getByRole('tab', { name: 'Столбцы', exact: true }).click()
    await expect(page.getByRole('dialog', { name: profile.settingsLabel }).getByRole('checkbox', { name: 'Следующий шаг' })).not.toBeChecked()
    await page.getByRole('tab', { name: 'Столбцы', exact: true }).click()
    await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Открыть прежнюю таблицу для сравнения' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })).toHaveValue(PROJECT)
    await expect(page.locator('.journal-density-compact')).toBeVisible()
  })

  test(name('обязательные поля, оба действия видимости и итоги выделенных групп с запятой при копировании'), async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(profile.route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    const panel = page.getByRole('dialog', { name: profile.settingsLabel })
    await showAllColumns(page)
    await panel.getByRole('button', { name: 'Скрыть все', exact: true }).click()
    await panel.getByRole('button', { name: 'Закрыть настройки вида' }).click()
    const fields = ['line', 'joint', 'wdi', 'weldDate', 'finalStatus', '__actions']
    const visibleFields = () => page.locator(`${profile.grid} .ag-header-cell[col-id]`).evaluateAll(headers => headers.map(header => header.getAttribute('col-id')).filter(id => !id?.startsWith('ag-')).sort())
    await expect.poll(visibleFields).toEqual([...fields].sort())
    await page.reload()
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await expect.poll(visibleFields).toEqual([...fields].sort())
    await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: groupLabel('Линия'), exact: true }).click()
    await waitForGridRows(page)
    const first = page.locator('.ag-grid-scrolling-rows .ag-row[row-index="0"] [col-id="wdi"]')
    await expect(first).toContainText('45,6')
    await page.waitForLoadState('networkidle')
    const calls: string[] = []
    page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
    await first.click()
    await page.keyboard.press('Shift+ArrowDown')
    const stats = page.getByLabel('Статистика выделения', { exact: true })
    await expect(stats).toContainText('Количество: 2')
    await expect(stats).toContainText('Сумма: 91,2')
    await expect(stats).toContainText('Среднее: 45,6')
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replaceAll('\r\n', '\n'))).toBe('45,6\n45,6')
    await page.waitForLoadState('networkidle')
    {
      expect(calls.filter(name => name.startsWith('summarizeJournalGridRange')).length).toBeLessThanOrEqual(2)
      // Joint/WDI/date statistics are separate from numeric cell statistics.
      expect(calls.filter(name => name.startsWith('summarizeJournalGridArea')).length).toBeLessThanOrEqual(2)
      expect(calls.filter(name => name.startsWith('copyJournalGridRange'))).toHaveLength(1)
      expect(calls.every(name => /^(summarizeJournalGridRange|summarizeJournalGridArea|copyJournalGridRange)_/.test(name))).toBe(true)
    }
  })

  test(name('клавиатура, копирование диапазона и серверная сортировка'), async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(profile.route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    const projectCell = page.locator('.ag-grid-scrolling-rows .ag-row[row-index="0"] [col-id="projectTitle"]')
    await projectCell.click()
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replaceAll('\r\n', '\n'))).toBe(`${PROJECT}\tAG\n${PROJECT}\tAG`)
    await projectCell.click()
    await page.keyboard.press('Tab')
    await expect(page.locator('.ag-cell-focus')).toHaveAttribute('col-id', isWorkflow ? 'jointNextAction' : 'subtitleCode')
    if (isWorkflow) {
      await revealColumn(page, 'subtitleCode')
      await page.locator('.ag-row[row-index="0"] [col-id="subtitleCode"]').click()
      await page.keyboard.press('F2')
      await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toHaveCount(0)
      await revealColumn(page, noteField)
      await page.locator(`.ag-row[row-index="0"] [col-id="${noteField}"]`).click()
    }
    await page.keyboard.press('F2')
    await expect(page.getByRole('heading', { name: editHeading, exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click()
    const header = page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-text')
    const headerX = (await header.boundingBox())!.x
    await header.click()
    expect(Math.abs((await header.boundingBox())!.x - headerX)).toBeLessThan(1)
    await expect(page.locator('.ag-header-cell[col-id="line"]')).toHaveAttribute('aria-sort', 'ascending')
    await expect(page.getByRole('button', { name: 'F2001', exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await header.click()
    await expect(page.locator('.ag-header-cell[col-id="line"]')).toHaveAttribute('aria-sort', 'descending')
    await expect(page.getByRole('button', { name: 'F2250', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'F2250', exact: true }).locator('xpath=ancestor::*[@role="row"]')).toHaveAttribute('row-index', '0')
    if (!isWorkflow) {
      await page.locator('.ag-header-cell[col-id="line"]').focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('.ag-header-cell[col-id="line"]')).toHaveAttribute('aria-sort', 'none')
      await expect(page.getByRole('button', { name: 'F2001', exact: true })).toBeVisible()
    }
  })

  test(name('короткий переход готовых фильтров и сортировок сохраняет живую таблицу'), async ({ page }) => {
    await page.goto(profile.route)
    await expect(page.locator(`${profile.grid} .ag-root`)).toBeVisible()
    await page.waitForLoadState('networkidle')
    const motion = await observeGridResults(page, '.journal-grid-frame .ag-grid-scrolling-container')
    const root = (await page.locator(`${profile.grid} .ag-root`).elementHandle())!
    const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
    await search.fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await motion.completed(1)
    await expect(search).toBeFocused()
    const header = page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-text')
    for (let i = 0; i < 4; i++) {
      await header.click()
      await motion.completed(i + 2)
      expect(await root.evaluate(element => element.isConnected)).toBe(true)
    }
    await search.fill('NO-SUCH-GRID-RESULT')
    await expect(page.getByText(loaded(0, 0), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await motion.completed(6)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await search.fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.waitForLoadState('networkidle')
    expect((await motion.read()).length).toBe(6)
  })

  // The former synthetic wheel handoff belonged to the retired client-page
  // adapter. Every profile now uses the same native document scroll contract.
  test(name('native document scroll retains selection and reads only visible blocks'), async ({ page }) => {
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    const first = page.getByRole('button', { name: 'F2001', exact: true }).locator('xpath=ancestor::*[@role="row"]')
    await first.getByRole('checkbox').check()
    await page.waitForLoadState('networkidle')
    const blocks: Array<{ start: number; end: number }> = []
    page.on('request', request => {
      if (rpcName(request.url()).startsWith('readJournalGrid_')) blocks.push((deserializeRpcPayload(request.postData()!) as { data: { start: number; end: number } }).data)
    })
    const viewport = page.locator('.ag-grid-viewport')
    const box = (await viewport.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, Math.min(800, box.y + 140))
    await page.mouse.wheel(0, 800)
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500)
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    // The frame's one-pixel top border remains visible above its sticky header.
    await expect.poll(() => page.locator('.ag-header').evaluate(element => Math.abs(element.getBoundingClientRect().top))).toBeLessThanOrEqual(1)
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await expect(page.getByRole('button', { name: 'F2250', exact: true })).toBeVisible()
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.length).toBeLessThanOrEqual(3)
    expect(blocks.every(block => block.end - block.start <= 100)).toBe(true)
    expect(await page.locator('.ag-grid-scrolling-rows .ag-row').count()).toBeLessThan(60)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await expect(first.getByRole('checkbox')).toBeChecked()
  })

  test(name('только своё ПКМ, русский заголовок, Escape и стабильный фильтр с колесом'), async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto(profile.route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    const header = page.locator('.ag-header-cell[col-id="line"]')
    await expect(header.locator('.ag-header-cell-menu-button')).toHaveCount(0)
    // Record the cancellation synchronously, as a browser would decide to open its native menu.
    await page.evaluate(() => {
      document.addEventListener('contextmenu', event => { document.documentElement.dataset.contextPrevented = String(event.defaultPrevented) })
    })
    await page.locator('[data-journal-toolbar]').click({ button: 'right', position: { x: 10, y: 10 } })
    await expect(page.locator('html')).toHaveAttribute('data-context-prevented', 'true')
    await header.click({ button: 'right' })
    await expect(page.locator('html')).toHaveAttribute('data-context-prevented', 'true')
    await expect(page.getByRole('menuitem', { name: 'Ширина по содержимому' })).toBeVisible()
    await expect(page.locator('.ag-menu')).not.toContainText('Autosize')
    await page.keyboard.press('Escape')
    await expect(page.locator('.ag-menu')).toHaveCount(0)
    await expect(page.getByRole('searchbox')).toHaveValue(PROJECT)
    const cell = page.locator('.ag-row[row-index="0"] [col-id="line"]')
    await cell.click({ button: 'right' })
    await expect(page.locator('html')).toHaveAttribute('data-context-prevented', 'true')
    await expect(page.getByRole('button', { name: 'Картина стыка', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Картина стыка', exact: true })).toHaveCount(0)
    await header.locator('.ag-header-cell-filter-button').click()
    const filter = page.getByRole('dialog', { name: 'Фильтр: Линия' })
    await expect(filter.getByRole('checkbox').first()).toBeVisible()
    await expect.poll(async () => { const box = (await filter.boundingBox())!; return box.y + box.height }).toBeLessThanOrEqual(720)
    const before = await page.evaluate(() => ({ page: scrollY, grid: document.querySelector('.ag-grid-viewport')!.scrollTop }))
    await filter.locator('.journal-filter-values').hover()
    await page.mouse.wheel(0, 240)
    await expect.poll(() => filter.locator('.journal-filter-values').evaluate(e => e.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => ({ page: scrollY, grid: document.querySelector('.ag-grid-viewport')!.scrollTop }))).toEqual(before)
    await expect(filter).toBeVisible()
    await filter.getByLabel('Найти значение фильтра').fill('AG-0250')
    await filter.getByRole('checkbox').check()
    await expect.poll(() => filter.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await expect(page.getByText(loaded(1, 1), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await expect(filter).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(filter).toHaveCount(0)
    await expect(page.getByText(loaded(1, 1), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    // A popup no longer owns Escape; the report's original reset behavior takes over.
    await page.getByRole('gridcell', { name: 'AG-0250', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('searchbox')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Сбросить', exact: true })).toHaveCount(0)
  })

  test(name('resize, автоматическая загрузка, компактная панель и однократный Escape из редактирования'), async ({ page }) => {
    await page.goto(profile.route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    const toolbar = page.locator('[data-journal-toolbar]')
    await expect(toolbar.getByRole('button', { name: 'Настроить вид' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: /^(Разделы|Наборы|Столбцы|Виды|Оформление)$/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Настроить вид' }).click()
    const panel = page.getByRole('dialog', { name: profile.settingsLabel })
    const box = (await panel.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await expect(panel.getByLabel('Набор столбцов')).toHaveCount(0)
    await panel.getByRole('checkbox', { name: 'Раздел: Материалы', exact: true }).uncheck()
    await expect(panel).toBeVisible()
    await showAllColumns(page)
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(page.getByRole('searchbox')).toHaveValue(PROJECT)
    const resize = page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-resize')
    await expect(resize).toHaveCSS('cursor', 'col-resize')
    const width = (await page.locator('.ag-header-cell[col-id="line"]').boundingBox())!.width
    const handle = (await resize.boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down(); await page.mouse.move(handle.x + 90, handle.y + handle.height / 2, { steps: 6 }); await page.mouse.up()
    await expect.poll(async () => (await page.locator('.ag-header-cell[col-id="line"]').boundingBox())!.width).toBeGreaterThan(width + 50)
    const size = page.getByRole('combobox', { name: 'Размер порции строк' })
    await expect(size).toHaveCount(0)
    // The journal retains its full editor/suggestions; PSTO has a dedicated note editor.
    if (isWorkflow) await revealColumn(page, noteField)
    await page.locator(`.ag-row[row-index="0"] [col-id="${isWorkflow ? noteField : 'subtitleCode'}"]`).click()
    await page.keyboard.press('F2')
    await expect(page.getByRole('heading', { name: editHeading, exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('textbox', { name: isWorkflow ? editHeading : 'Линия', exact: true }).fill('AG-')
    if (!isWorkflow) await expect(page.getByRole('dialog').getByRole('button', { name: /^AG-000/ }).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: editHeading, exact: true })).toHaveCount(0)
    await expect(page.getByRole('searchbox')).toHaveValue(PROJECT)
    if (isWorkflow) {
      await page.locator(`.ag-row[row-index="0"] [col-id="${noteField}"]`).click()
      await page.keyboard.press('F2')
      const editor = page.getByRole('dialog')
      await editor.getByRole('button', { name: 'Отмена', exact: true }).focus()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { name: editHeading, exact: true })).toHaveCount(0)
      await expect(page.getByRole('searchbox')).toHaveValue(PROJECT)
    }
  })

  test(name(`прокрутка ${isWorkflow ? 'всех профильных' : '111'} столбцов без фоновых запросов и лишних DOM-строк`), async ({ page }, info) => {
    const calls: string[] = []
    page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.getByRole('button', { name: 'Настроить вид' }).click()
    await showAllColumns(page)
    await page.keyboard.press('Escape')
    await expect(page.getByText(loaded(250, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.waitForLoadState('networkidle')
    const viewport = page.locator('.ag-grid-viewport')
    await viewport.hover()
    await page.mouse.wheel(0, 800)
    await expect.poll(() => viewport.evaluate(e => e.scrollTop)).toBeGreaterThan(0)
    const before = calls.length
    await page.evaluate(() => {
      const state = { frames: [] as number[], longTasks: [] as number[], active: true, last: performance.now() }
      const observer = new PerformanceObserver(list => { if (state.active) state.longTasks.push(...list.getEntries().map(entry => entry.duration)) })
      observer.observe({ type: 'longtask' })
      const frame = (now: number) => { if (state.active) { state.frames.push(now - state.last); state.last = now; requestAnimationFrame(frame) } }
      requestAnimationFrame(frame)
      Object.assign(window, { journalScrollMeasure: { state, observer } })
    })
    for (let index = 0; index < 36; index++) {
      await page.mouse.wheel(index < 18 ? 0 : 90, index < 18 ? 100 : 0)
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    }
    const measurement = await page.evaluate(() => {
      const { state, observer } = (window as unknown as { journalScrollMeasure: { state: { frames: number[]; longTasks: number[]; active: boolean }; observer: PerformanceObserver } }).journalScrollMeasure
      state.active = false; observer.disconnect()
      const frames = state.frames.slice(1).sort((a, b) => a - b)
      return { frames: frames.length, p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1), longTasks: state.longTasks,
        renderedRows: document.querySelectorAll('.ag-grid-scrolling-rows .ag-row').length, cells: document.querySelectorAll('.ag-grid-scrolling-rows .ag-cell').length }
    })
    console.info(`${profile.prefix} scroll:`, JSON.stringify(measurement))
    await info.attach('scroll-measurement.json', { body: JSON.stringify(measurement), contentType: 'application/json' })
    expect(measurement.frames).toBeGreaterThan(20)
    expect(measurement.p95).toBeLessThan(35)
    expect(measurement.renderedRows).toBeLessThan(60)
    expect(measurement.cells).toBeLessThan(1500)
    expect(calls.slice(before)).toEqual([])
  })

  test(name('единый список значений без условий и иерархия дат'), async ({ page }) => {
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
    const lineFilter = page.getByRole('dialog', { name: 'Фильтр: Линия' })
    await expect(lineFilter.getByRole('tab')).toHaveCount(0)
    await lineFilter.getByLabel('Найти значение фильтра').fill('AG-0002')
    await lineFilter.getByRole('checkbox').check()
    await expect(page.getByText(loaded(1, 1), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await expect(page.getByRole('button', { name: 'F2002', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
    await expect(lineFilter.getByRole('checkbox')).toBeChecked()
    await lineFilter.getByRole('button', { name: 'Сбросить фильтр' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.getByRole('button', { name: 'Настроить вид' }).click()
    await showAllColumns(page)
    await page.keyboard.press('Escape')
    await revealColumn(page, 'weldDate')
    await page.locator('.ag-header-cell[col-id="weldDate"] .ag-header-cell-filter-button').click()
    const dateFilter = page.getByRole('dialog', { name: 'Фильтр: Дата сварки' })
    await expect(dateFilter.getByRole('checkbox', { name: 'Год 2026', exact: true })).toBeVisible()
    await dateFilter.getByRole('button', { name: 'Развернуть Год 2026', exact: true }).click()
    await expect(dateFilter.getByRole('checkbox', { name: 'Сентябрь 2026', exact: true })).toBeVisible()
    await dateFilter.getByRole('button', { name: 'Развернуть Сентябрь 2026', exact: true }).click()
    await dateFilter.getByRole('checkbox', { name: 'День 01.09.2026', exact: true }).check()
    await expect(dateFilter.getByRole('checkbox', { name: 'День 01.09.2026', exact: true })).toBeChecked()
    await page.waitForLoadState('networkidle')
    await expect(dateFilter).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dateFilter).toHaveCount(0)
  })


  test(name('меню столбца сортирует весь отчёт, группирует всю выборку и открывает настройки'), async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    const header = page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-text')
    await header.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
    await expect(page.getByRole('button', { name: 'F2250', exact: true }).locator('xpath=ancestor::*[@role="row"]')).toHaveAttribute('row-index', '0')
    await page.locator('.ag-header-cell[col-id="projectTitle"] .ag-header-cell-text').click({ button: 'right' })
    await page.getByRole('menuitem', { name: groupLabel('Проект') }).click()
    await expect(page.getByRole('button', { name: 'Группировка: Проект', exact: true })).toBeVisible()
    const group = page.locator('.ag-row-group').first()
    await expect(group).toContainText(PROJECT)
    await expect(group).toContainText('250 лин.')
    await group.locator('.ag-group-contracted').click()
    await expect(page.getByRole('button', { name: 'F2250', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Снять все группировки', exact: true }).click()
    await expect(page.locator('.ag-row-group')).toHaveCount(0)
    await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
    // Ungrouping briefly has no rows: a wheel during that phase reaches the
    // temporary page bottom before the leaf response creates the scroll range.
    await expect.poll(() => page.locator('.ag-grid-viewport').evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(1000)
    await waitForGridRows(page)
    await page.locator('.ag-grid-viewport').hover()
    // The toolbar height depends on wrapped workflow controls. Scroll beyond
    // its measured bottom rather than assuming a fixed 500px is sufficient.
    const toolbarBottom = isWorkflow ? await page.locator('[data-journal-toolbar]').evaluate(element => element.getBoundingClientRect().bottom) : 0
    await page.mouse.wheel(0, Math.max(500, toolbarBottom + 100))
    if (isWorkflow) await expect.poll(() => page.locator('[data-journal-toolbar]').evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThan(1)
    await header.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Выбрать столбцы', exact: true }).click()
    await expect(page.getByRole('dialog', { name: profile.settingsLabel })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Столбцы', exact: true })).toHaveAttribute('aria-selected', 'true')
    expect((await page.getByRole('dialog', { name: profile.settingsLabel }).boundingBox())!.y).toBeGreaterThanOrEqual(0)
    expect(errors).toEqual([])
  })

  test(name('F2/Enter выбирают строки и открывают следующий шаг, стрелки возвращаются после меню и карточки'), async ({ page }) => {
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    const first = page.locator('.ag-row[row-index="0"]')
    const selection = first.locator('.ag-cell[col-id^="ag-Grid-SelectionColumn"]')
    await first.locator('[col-id="line"]').click()
    await page.keyboard.press('Shift+Tab')
    await expect(page.locator('.ag-cell-focus')).toHaveAttribute('col-id', /^ag-Grid-SelectionColumn/)
    await expect(selection.getByRole('checkbox')).not.toBeChecked()
    await page.keyboard.press('F2')
    await expect(selection.getByRole('checkbox')).toBeChecked()
    await page.keyboard.press('Enter')
    await expect(selection.getByRole('checkbox')).not.toBeChecked()
    const selectAll = page.locator('.ag-header-cell').filter({ has: page.getByRole('checkbox') })
    await selectAll.focus()
    await page.keyboard.press('F2')
    await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 250')
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('Статистика выделения')).not.toContainText('Выбрано:')
    const line = first.locator('[col-id="line"]')
    await line.click({ button: 'right' })
    await expect(page.getByRole('button', { name: 'Картина стыка', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('searchbox')).toHaveValue(PROJECT)
    // Menu removal restores focus on the next animation frame. Checking the
    // unchanged search value alone can finish before that frame (~8 ms).
    await expect(page.getByTestId('context-action-menu')).toHaveCount(0)
    await expect(page.locator('.ag-cell-focus')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.ag-cell-focus').locator('xpath=ancestor::*[@role="row"]')).toHaveAttribute('row-index', '1')
    for (let i = 0; i < 3; i++) {
      if (isWorkflow) await revealColumn(page, noteField)
      await page.locator(`.ag-row[row-index="0"] [col-id="${isWorkflow ? noteField : 'subtitleCode'}"]`).click()
      await page.keyboard.press('F2')
      await expect(page.getByRole('heading', { name: editHeading, exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { name: editHeading, exact: true })).toHaveCount(0)
      await expect(page.locator('.ag-cell-focus')).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(page.locator('.ag-cell-focus').locator('xpath=ancestor::*[@role="row"]')).toHaveAttribute('row-index', '1')
    }
    await revealColumn(page, 'jointNextAction')
    const next = page.locator('.ag-row[row-index="0"] [data-joint-next-action-cell]').locator('xpath=ancestor::*[@role="gridcell"]')
    await next.focus()
    await page.keyboard.press('Tab')
    await expect(next.getByRole('button').first()).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(next.getByRole('button').last()).toBeFocused()
    await page.keyboard.press('F2')
    await expect(page.locator('[data-modal-dialog="true"]')).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test(name('оформление, статистика диапазона, числовой фильтр и Tab через системные поля'), async ({ page }) => {
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    const searchBox = (await page.getByRole('searchbox').boundingBox())!
    const settingsButton = (await page.getByRole('button', { name: 'Настроить вид' }).boundingBox())!
    expect(settingsButton.x - searchBox.x - searchBox.width).toBeLessThan(20)
    await page.getByRole('button', { name: 'Настроить вид' }).click()
    await showAllColumns(page)
    await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
    const panel = page.getByRole('dialog', { name: profile.settingsLabel })
    await expect(panel.getByLabel('Поле сортировки')).toHaveCount(0)
    await panel.getByRole('switch', { name: 'Перенос текста' }).uncheck()
    await expect(page.locator('.journal-no-wrap')).toBeVisible()
    await panel.getByRole('combobox', { name: 'Плотность строк' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(page.locator('.journal-density-spacious')).toBeVisible()
    await page.keyboard.press('Escape')
    await revealColumn(page, 'd1')
    const header = page.locator('.ag-header-cell[col-id="d1"]')
    await header.scrollIntoViewIfNeeded()
    await header.locator('.ag-header-cell-filter-button').click()
    const filter = page.getByRole('dialog', { name: 'Фильтр: D1' })
    await expect(filter.locator('.journal-filter-option')).toContainText('215')
    await expect(filter.locator('.journal-filter-option')).not.toContainText('215.000')
    await page.keyboard.press('Escape')
    await revealColumn(page, 't1')
    await page.locator('.ag-header-cell[col-id="t1"] .ag-header-cell-filter-button').click()
    const decimalFilter = page.getByRole('dialog', { name: 'Фильтр: T1' })
    await expect(decimalFilter.locator('.journal-filter-option')).toContainText('10,3')
    await decimalFilter.getByLabel('Найти значение фильтра').fill('10,3')
    await decimalFilter.getByRole('checkbox').check()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.keyboard.press('Escape')
    await revealColumn(page, 'd1')
    const d1 = page.locator('.ag-row[row-index="0"] [col-id="d1"]')
    await d1.click()
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    const summary = page.getByLabel('Статистика выделения')
    await expect(summary).toContainText('Количество: 3')
    await expect(summary).toContainText('Среднее: 215')
    await expect(summary).toContainText('Сумма: 645')
    await expect(page.getByLabel('Действия с выбранными стыками')).toHaveCount(0)
    await page.locator('.ag-row[row-index="0"]').getByRole('checkbox').check()
    await expect(summary).toContainText('Выбрано: 1')
    // The final status is now pinned at the right edge: Tab goes to the next
    // row's selection, then its first editable field or native action column.
    await revealColumn(page, 'finalStatus')
    await page.locator('.ag-row[row-index="0"] [col-id="finalStatus"]').click({ position: { x: 2, y: 5 } })
    await page.keyboard.press('Tab')
    const focused = await page.locator('.ag-cell-focus').getAttribute('col-id')
    expect(focused).toMatch(/^ag-Grid-SelectionColumn/)
    await page.keyboard.press('Tab')
    await expect(page.locator('.ag-cell-focus')).toHaveAttribute('col-id', isWorkflow ? 'jointNextAction' : 'line')
    if (isWorkflow) {
      for (const field of isPsto ? ['line', 'pstoRequired', 'pstoRequest', 'pstoResult', 'tvmtResult'] : ['line', 'hasVik', 'vikRequest', 'vikResult']) {
        await revealColumn(page, field)
        await page.locator(`.ag-row[row-index="0"] [col-id="${field}"]`).click({ position: { x: 2, y: 5 } })
        await page.keyboard.press('F2')
        await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toHaveCount(0)
        await expect(page.getByRole('heading', { name: editHeading, exact: true })).toHaveCount(0)
      }
      await revealColumn(page, noteField)
      await page.locator(`.ag-row[row-index="0"] [col-id="${noteField}"]`).click()
    }
    await page.keyboard.press('F2')
    await expect(page.getByRole('heading', { name: editHeading, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test(name('сброс возвращает исходный порядок, видимость и закрепление даже после перезагрузки'), async ({ page }) => {
    await page.goto(profile.route)
    await expect(page.locator('.ag-grid-pinned-left-cells [col-id="line"]').first()).toBeVisible()
    await expect(page.locator('.ag-grid-pinned-left-cells [col-id="joint"]').first()).toBeVisible()
    await expect(page.locator('.ag-grid-pinned-right-cells [col-id="finalStatus"]').first()).toBeVisible()
    const reset = async () => {
      await page.locator('.ag-header-group-cell').filter({ hasText: 'Стык' }).first().click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Сбросить столбцы', exact: true }).click()
    }
    await reset()
    const canonical = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).columns, profile.storageKey)
    expect(canonical.filter((c: { pinned: string }) => c.pinned === 'left').map((c: { colId: string }) => c.colId)).toEqual(['ag-Grid-SelectionColumn', 'line', 'joint'])
    expect(canonical.filter((c: { pinned: string }) => c.pinned === 'right').map((c: { colId: string }) => c.colId)).toEqual(['finalStatus'])
    await page.locator('.ag-header-group-cell').filter({ hasText: 'Проект' }).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Скрыть раздел', exact: true }).click()
    await expect(page.locator('.ag-header-cell[col-id="line"]')).toBeVisible()
    await expect(page.locator('.ag-header-cell[col-id="projectTitle"]')).toHaveCount(0)
    await reset()
    await expect(page.locator('.ag-header-cell[col-id="line"]')).toBeVisible()
    await page.locator('.ag-header-cell[col-id="subtitleCode"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true }).click()
    await expect(page.locator('.ag-header-cell[col-id="subtitleCode"]')).toHaveCount(0)
    // A saved custom order must not become the reset baseline on the next mount.
    await page.evaluate(key => {
      const value = JSON.parse(localStorage.getItem(key)!)
      value.columns.reverse()
      for (const column of value.columns) if (!column.colId.startsWith('ag-')) { column.width = 190; column.pinned = null }
      localStorage.setItem(key, JSON.stringify(value))
    }, profile.storageKey)
    await page.reload()
    await page.getByRole('button', { name: 'Настроить вид' }).click()
    await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
    await page.getByRole('button', { name: 'Сбросить столбцы', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.ag-grid-pinned-left-cells [col-id="line"]').first()).toBeVisible()
    await expect(page.locator('.ag-grid-pinned-right-cells [col-id="finalStatus"]').first()).toBeVisible()
    await page.locator('.ag-grid-viewport').evaluate(e => { e.scrollLeft = 0 })
    await expect(page.locator('.ag-header-cell[col-id="subtitleCode"]')).toBeVisible()
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).columns, profile.storageKey)).toEqual(canonical)
    await page.reload()
    await expect(page.locator('.ag-grid-pinned-right-cells [col-id="finalStatus"]').first()).toBeVisible()
  })

  test(name('булавки и закрепление только через ПКМ, порядок по-прежнему меняется мышью'), async ({ page }) => {
    await page.goto(profile.route)
    await expect(page.locator('.ag-header-cell[col-id="line"] .journal-column-pin')).toHaveAttribute('title', /Закреплён слева/)
    await expect(page.locator('.ag-header-cell[col-id="finalStatus"] .journal-column-pin')).toHaveAttribute('title', /Закреплён справа/)
    const pin = async (field: string, option: string) => {
      await page.locator(`.ag-header-cell[col-id="${field}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
      await page.getByRole('menuitemcheckbox', { name: option, exact: true }).click()
    }
    const pins = () => page.locator('.ag-header-cell:has(.journal-column-pin)').evaluateAll(headers => headers.map(h => h.getAttribute('col-id')).sort())
    const initial = await pins()
    expect(initial).toEqual(['finalStatus', 'joint', 'line'])
    const drag = async (source: import('@playwright/test').Locator, x: number, y: number) => {
      const box = (await source.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(x, y, { steps: 20 })
      // AG's edge pinning normally starts after holding the column for a second.
      await page.waitForTimeout(1200)
      await page.mouse.up()
    }
    const lineBox = (await page.locator('.ag-header-cell[col-id="line"]').boundingBox())!
    await drag(page.locator('.ag-header-cell[col-id="projectTitle"]'), lineBox.x + 20, lineBox.y + 24)
    expect(await pins()).toEqual(initial)
    const group = page.locator('.ag-header-group-cell').filter({ hasText: 'Проект' }).last()
    const groupBox = (await group.boundingBox())!
    await drag(group, lineBox.x + 20, groupBox.y + 12)
    expect(await pins()).toEqual(initial)

    await pin('projectTitle', 'Слева')
    await expect(page.locator('.ag-header-cell[col-id="projectTitle"] .journal-column-pin')).toHaveAttribute('title', /Закреплён слева/)
    await page.reload()
    await expect(page.locator('.ag-header-cell[col-id="projectTitle"] .journal-column-pin')).toBeVisible()
    await pin('projectTitle', 'Справа')
    await expect(page.locator('.ag-header-cell[col-id="projectTitle"] .journal-column-pin')).toHaveAttribute('title', /Закреплён справа/)
    await pin('projectTitle', 'Не закреплять')
    await expect(page.locator('.ag-header-cell[col-id="projectTitle"] .journal-column-pin')).toHaveCount(0)
    const jointBox = (await page.locator('.ag-header-cell[col-id="joint"]').boundingBox())!
    await drag(page.locator('.ag-header-cell[col-id="line"]'), jointBox.x + jointBox.width - 12, jointBox.y + 24)
    await expect.poll(async () => (await page.locator('.ag-header-cell[col-id="line"]').boundingBox())!.x)
      .toBeGreaterThan((await page.locator('.ag-header-cell[col-id="joint"]').boundingBox())!.x)
    expect(await pins()).toEqual(initial)
  })

  test(name('темы сохраняются с видом, а группы и счётчики выровнены во всех темах'), async ({ page }) => {
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.locator('.ag-header-cell[col-id="projectTitle"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: groupLabel('Проект') }).click()
    const group = page.locator('.ag-row.ag-row-group').first()
    for (const name of ['Классическая', 'Нейтральная', 'Светлая']) {
      await page.getByRole('button', { name: 'Настроить вид' }).click()
      await page.getByRole('tab', { name: 'Темы', exact: true }).click()
      await page.getByRole('radio', { name: new RegExp(name) }).click()
      await expect(page.getByRole('radio', { name: new RegExp(name) })).toHaveAttribute('aria-checked', 'true')
      await page.keyboard.press('Escape')
      await expect(group).toContainText(PROJECT)
      const title = (await group.locator('.ag-group-value').boundingBox())!, count = (await group.locator('.ag-group-child-count').boundingBox())!
      expect(Math.abs(title.y + title.height / 2 - count.y - count.height / 2)).toBeLessThan(2)
      expect(count.x).toBeGreaterThan(title.x + title.width)
      expect(title.x - (await page.locator('.journal-grid-frame').boundingBox())!.x).toBeLessThan(100)
    }
    await group.locator('.ag-group-contracted').click()
    await expect(page.getByRole('button', { name: 'F2001', exact: true })).toBeVisible()
    await group.locator('[col-id="line"]').focus()
    await page.keyboard.press('F2')
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    const groupTitleX = (await group.locator('.ag-group-value').boundingBox())!.x
    await page.locator('.ag-grid-viewport').evaluate(e => { e.scrollLeft = 1500 })
    expect((await group.locator('.ag-group-value').boundingBox())!.x).toBe(groupTitleX)
    await page.getByRole('button', { name: 'Настроить вид' }).click()
    await page.getByRole('tab', { name: 'Темы', exact: true }).click()
    await page.getByRole('radio', { name: /Классическая/ }).click()
    await page.getByRole('tab', { name: 'Мои виды', exact: true }).click()
    await page.getByLabel('Название вида').fill('Зелёный журнал')
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await page.getByRole('tab', { name: 'Темы', exact: true }).click()
    await page.getByRole('radio', { name: /Нейтральная/ }).click()
    await page.reload()
    await expect(page.locator('.journal-theme-balham')).toBeVisible()
    await page.getByRole('button', { name: 'Настроить вид' }).click()
    await page.getByRole('tab', { name: 'Мои виды', exact: true }).click()
    await page.getByRole('button', { name: /^Зелёный журнал Фильтров/ }).click()
    await expect(page.locator('.journal-theme-alpine')).toBeVisible()
    await expect(group).toContainText(PROJECT)
  })

  test(name('ширина следует за курсором без запросов и сохраняется после отпускания'), async ({ page }, info) => {
    const calls: string[] = []
    page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.waitForLoadState('networkidle')
    const before = calls.length
    const header = page.locator('.ag-header-cell[col-id="line"]'), handle = header.locator('.ag-header-cell-resize')
    const box = (await handle.boundingBox())!, initialWidth = (await header.boundingBox())!.width
    const samples: Array<{ delta: number; width: number; elapsed: number }> = []
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let index = 1; index <= 48; index++) {
      const delta = index <= 24 ? index * 4 : (48 - index) * 4
      const start = performance.now()
      await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2)
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      const width = (await header.boundingBox())!.width
      samples.push({ delta, width, elapsed: performance.now() - start })
      expect(Math.abs(width - initialWidth - delta)).toBeLessThan(2)
    }
    await page.mouse.up()
    expect(calls.slice(before)).toEqual([])
    await info.attach('column-resize-tracking.json', { body: JSON.stringify(samples), contentType: 'application/json' })
    console.info(`${profile.prefix} resize: 48 samples, maximum cursor/column deviation`, Math.max(...samples.map(s => Math.abs(s.width - initialWidth - s.delta))))
  })

  test(name('вложенные группы выбирают стыки, поддерживают частичный выбор и сохраняют порядок без скачка панели'), async ({ page }, info) => {
    const errors: string[] = [], calls: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.waitForLoadState('networkidle')
    const layout = () => page.evaluate(() => ['[data-journal-toolbar]', '.journal-grid-frame', '[data-journal-footer]'].map(selector => {
      const box = document.querySelector(selector)!.getBoundingClientRect()
      return { top: box.top + window.scrollY, height: box.height }
    }))
    const alignedDispatcher = async () => {
      // Read both boxes in one frame: the sidebar animates their shared parent.
      const edges = await page.evaluate(() => {
        const panel = document.querySelector('[aria-label="Диспетчер задач"]')!.getBoundingClientRect()
        const grid = document.querySelector('.journal-grid-frame')!.getBoundingClientRect()
        return [Math.abs(panel.left - grid.left), Math.abs(panel.right - grid.right)]
      })
      expect(Math.max(...edges)).toBeLessThan(1)
    }
    await alignedDispatcher()
    const initial = await layout(), before = calls.length
    for (const [id, name] of [['projectTitle', 'Проект'], ['line', 'Линия']]) {
      await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: groupLabel(name), exact: true }).click()
    }
    const chips = page.locator('[data-journal-toolbar]').getByRole('list', { name: 'Порядок группировок' })
    await expect(page.locator('[data-journal-footer] .journal-grouping')).toHaveCount(0)
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Проект', 'Линия'])
    expect(await layout()).toEqual(initial)
    const chipsBox = (await chips.boundingBox())!, searchBox = (await page.getByRole('searchbox').boundingBox())!
    expect(chipsBox.x + chipsBox.width).toBeLessThan(searchBox.x)
    expect(Math.abs(chipsBox.y + chipsBox.height / 2 - searchBox.y - searchBox.height / 2)).toBeLessThan(2)
    await page.waitForLoadState('networkidle')
    {
      // Each of the two server-grouping changes may request its first block.
      const reads = calls.slice(before)
      expect(reads.length).toBeGreaterThan(0)
      expect(reads.length).toBeLessThanOrEqual(2)
      expect(reads.every(name => name.startsWith('readJournalGrid'))).toBe(true)
    }
    const parent = page.locator('.ag-row.ag-row-group.ag-row-level-0').first()
    const selectAll = page.locator('.ag-header-cell').getByRole('checkbox')
    await selectAll.click()
    await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 250')
    await expect(parent.getByRole('checkbox')).toBeChecked()
    await selectAll.click()
    // Server selection is asynchronous. Wait for the clear to finish before
    // testing F2; the old count of 250 must not satisfy its later assertion.
    await expect(page.getByLabel('Статистика выделения')).not.toContainText('Выбрано:')
    await expect(parent.getByRole('checkbox')).toBeEnabled()
    await parent.getByRole('checkbox').press('F2')
    await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 250')
    await expect(parent).toHaveAttribute('aria-expanded', 'false')
    await expect(parent.getByRole('checkbox')).toBeFocused()
    await expect(parent.getByRole('checkbox')).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('Статистика выделения')).not.toContainText('Выбрано:')
    await expect(parent.getByRole('checkbox')).toBeEnabled()
    await parent.locator('.ag-group-contracted').click()
    const child = page.locator('.ag-row.ag-row-group.ag-row-level-1').first()
    const chipColors = await chips.locator('.journal-grouping-chip').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor))
    expect(new Set(chipColors).size).toBe(2)
    // Expansion can replace a virtual row; wait for the connected row.
    await expect(parent).toHaveCSS('background-color', chipColors[0])
    await expect(child).toHaveCSS('background-color', chipColors[1])
    await child.getByRole('checkbox').click()
    await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 1')
    await expect(parent.getByRole('checkbox')).toBeChecked({ indeterminate: true })
    await child.locator('.ag-group-contracted').click()
    // The child checkbox is a group; the first actual joint keeps its normal checkbox.
    const jointRow = page.getByRole('button', { name: 'F2001', exact: true }).locator('xpath=ancestor::*[@role="row"]')
    await expect(jointRow.getByRole('checkbox')).toBeChecked()
    await jointRow.getByRole('checkbox').uncheck()
    await expect(parent.getByRole('checkbox')).not.toBeChecked()
    await expect(child.getByRole('checkbox')).not.toBeChecked()
    await parent.getByRole('checkbox').press('Space')
    await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 250')
    await selectAll.click()
    await chips.getByRole('button', { name: 'Группировка: Линия', exact: true }).press('Alt+ArrowLeft')
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Линия', 'Проект'])
    expect(await layout()).toEqual(initial)
    await page.reload()
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Линия', 'Проект'])
    const lineHandle = chips.getByRole('button', { name: 'Группировка: Линия', exact: true })
    const projectHandle = chips.getByRole('button', { name: 'Группировка: Проект', exact: true })
    const from = (await lineHandle.boundingBox())!, to = (await projectHandle.boundingBox())!
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
    await expect(page.locator('.journal-grouping-drag-preview')).toContainText('Линия')
    await expect(chips).toHaveCSS('scrollbar-width', 'none')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(pageWidth)
    await expect(chips.locator('[data-drop-side="after"]')).toHaveCount(1)
    await page.screenshot({ path: info.outputPath('group-drag.png') })
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Линия', 'Проект'])
    expect(await layout()).toEqual(initial)
    await page.mouse.up()
    await expect(page.locator('.journal-grouping-drag-preview')).toHaveCount(0)
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Проект', 'Линия'])
    // Grip and label are both draggable; Escape cancels without applying an order.
    const cancelFrom = (await lineHandle.boundingBox())!, cancelTo = (await projectHandle.boundingBox())!
    await page.mouse.move(cancelFrom.x + 8, cancelFrom.y + cancelFrom.height / 2)
    await page.mouse.down()
    await page.mouse.move(cancelTo.x + 8, cancelTo.y + cancelTo.height / 2, { steps: 6 })
    await expect(chips.locator('[data-drop-side="before"]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(page.locator('.journal-grouping-drag-preview')).toHaveCount(0)
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Проект', 'Линия'])
    await expect(page.getByRole('searchbox')).toHaveValue(PROJECT)
    // Dragging past the viewport edge must not create a page-wide scrollbar.
    await page.mouse.move(cancelFrom.x + 8, cancelFrom.y + cancelFrom.height / 2)
    await page.mouse.down()
    await page.mouse.move(page.viewportSize()!.width - 1, cancelFrom.y, { steps: 6 })
    await expect(page.locator('.journal-grouping-drag-preview')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(pageWidth)
    await page.mouse.up()
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Проект', 'Линия'])
    await lineHandle.locator('svg').dragTo(projectHandle.locator('svg'))
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Линия', 'Проект'])
    await page.reload()
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Линия', 'Проект'])
    await chips.getByRole('button', { name: 'Убрать группировку: Линия', exact: true }).click()
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Проект'])
    await page.getByRole('button', { name: 'Снять все группировки', exact: true }).click()
    await expect(page.locator('.ag-row.ag-row-group')).toHaveCount(0)
    await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
    await expect.poll(async () => (await page.locator('.journal-grid-frame').boundingBox())!.x).toBeLessThan(100)
    await alignedDispatcher()
    await page.setViewportSize({ width: 1000, height: 900 })
    await alignedDispatcher()
    // The existing journal layout uses 12px; LNK/PSTO retain their 20px
    // page padding. The shared dock must preserve each report's actual gap.
    const bottomGap = isWorkflow ? 20 : 12
    await expect.poll(async () => {
      return page.evaluate(bottom => {
        const footer = document.querySelector('[data-journal-footer]')!.getBoundingClientRect()
        const frame = document.querySelector('.journal-grid-frame')!.getBoundingClientRect()
        return Math.round(footer.bottom) === bottom && Math.abs(frame.bottom - footer.top) <= 1
      }, 900 - bottomGap)
    }).toBe(true)
    const narrow = await layout()
    for (const [id, name] of [['line', 'Линия'], ['projectTitle', 'Проект'], ['subtitleCode', 'Шифр'], ['groupName', 'Группа трубопровода']]) {
      await revealColumn(page, id)
      await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: groupLabel(name), exact: true }).click()
      expect(await layout()).toEqual(narrow)
    }
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveCount(4)
    expect(await chips.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    await page.setViewportSize({ width: 1600, height: 1000 })
    // Document scrolling resizes the sticky stage in ResizeObserver + rAF.
    // The footer is docked independently, so also wait for the grid's lower
    // edge before comparing drag geometry after the viewport resize.
    await expect.poll(async () => {
      return page.evaluate(bottom => {
        const footer = document.querySelector('[data-journal-footer]')!.getBoundingClientRect()
        const frame = document.querySelector('.journal-grid-frame')!.getBoundingClientRect()
        return Math.round(footer.bottom) === bottom && Math.abs(frame.bottom - footer.top) <= 1
      }, 1000 - bottomGap)
    }).toBe(true)
    const beforeWideDrag = await layout()
    const longLabel = chips.getByRole('button', { name: 'Группировка: Группа трубопровода', exact: true })
    await longLabel.dragTo(chips.getByRole('button', { name: 'Группировка: Линия', exact: true }))
    await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Группа трубопровода', 'Линия', 'Проект', 'Шифр'])
    expect(await layout()).toEqual(beforeWideDrag)
    await page.getByRole('button', { name: 'Настроить вид' }).click()
    await expect(page.getByRole('dialog', { name: profile.settingsLabel })).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Настройки таблицы' }).getByRole('tab')).toHaveText(['Столбцы', 'Оформление', 'Темы', 'Мои виды'])
    expect(errors).toEqual([])
  })

  test(name('прежнее условие сохранённого вида видно и заменяется списком, бейдж открывает картину стыка'), async ({ page }) => {
    await page.goto(profile.route)
    await expect(page.locator(`${profile.grid} .ag-root`)).toBeVisible()
    await page.evaluate(({ project, key }) => {
      const value = JSON.parse(localStorage.getItem(key)!)
      value.savedViews.push({ id: 'legacy-text-filter', name: 'Прежний фильтр', snapshot: {
        hiddenFieldKeys: [], collapsedSections: [], sort: null, columnFilters: { projectTitle: '=' + project, line: '=AG-0002' },
      } })
      localStorage.setItem(key, JSON.stringify(value))
    }, { project: PROJECT, key: `welding-report-view:v1:${report}` })
    await page.reload()
    await page.getByRole('button', { name: 'Настроить вид' }).click()
    await page.getByRole('tab', { name: 'Мои виды', exact: true }).click()
    await page.getByRole('button', { name: /^Прежний фильтр Фильтров/ }).click()
    await expect(page.getByRole('dialog', { name: profile.settingsLabel })).toHaveCount(0)
    await expect(page.getByText(loaded(1, 1), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await expect(page.getByRole('button', { name: 'F2002', exact: true })).toBeVisible()
    await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
    const filter = page.getByRole('dialog', { name: 'Фильтр: Линия' })
    await expect(filter.getByRole('tab')).toHaveCount(0)
    await expect(filter.getByText(/Сохранённый фильтр:/)).toContainText('=AG-0002')
    await filter.getByLabel('Найти значение фильтра').fill('AG-0001')
    await filter.getByRole('checkbox').check()
    await expect(page.getByRole('button', { name: 'F2001', exact: true })).toBeVisible()
    await expect(filter.getByText(/Сохранённый фильтр:/)).toHaveCount(0)
    await page.keyboard.press('Escape')
    const status = page.getByRole('button', { name: 'F2001', exact: true }).locator('xpath=ancestor::*[@role="row"]').locator('[col-id="finalStatus"]')
    const badge = status.locator('[data-weld-badge]')
    const badgeBox = (await badge.boundingBox())!, cellBox = (await status.boundingBox())!
    expect(badgeBox.x - cellBox.x).toBeLessThan(15)
    await status.getByRole('button').click()
    await expect(page.getByRole('heading', { name: 'Картина стыка F2001', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
    await filter.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
  })

  test(name('ПКМ группы сворачивает и разворачивает один уровень или все, сохраняя выбор и фильтр'), async ({ page }) => {
    const errors: string[] = [], calls: string[] = []
    const blocks: { start: number; end: number }[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => {
      const name = rpcName(request.url()); if (name) calls.push(name)
      if (name.startsWith('readJournalGrid')) blocks.push((deserializeRpcPayload(request.postData()!) as { data: { start: number; end: number } }).data)
    })
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.waitForLoadState('networkidle')
    const before = calls.length
    for (const id of ['projectTitle', 'line']) {
      await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    }
    const root = page.locator('.ag-row.ag-row-group.ag-row-level-0')
    const line = (name: string) => page.locator('.ag-row.ag-row-group.ag-row-level-1:not(.ag-opacity-zero)')
      .filter({ has: page.getByText(name, { exact: true }) })
    const menu = page.getByTestId('context-action-menu')
    await root.click({ button: 'right', position: { x: 550, y: 18 } })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Свернуть', exact: true })).toBeDisabled()
    for (const name of ['Свернуть', 'Развернуть', 'Свернуть все', 'Развернуть все']) {
      await expect(menu.getByRole('button', { name, exact: true }).locator('svg')).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(page.getByRole('searchbox')).toHaveValue(PROJECT)
    await root.locator('.ag-group-value').click({ button: 'right' })
    await menu.getByRole('button', { name: 'Развернуть', exact: true }).click()
    await expect(root).toHaveAttribute('aria-expanded', 'true')
    await expect(line('AG-0001')).toHaveAttribute('aria-expanded', 'false')
    await line('AG-0001').locator('.ag-group-value').click({ button: 'right' })
    await menu.getByRole('button', { name: 'Развернуть все', exact: true }).click()
    const joint = page.getByRole('button', { name: 'F2001', exact: true })
    await expect(joint).toBeVisible()
    await joint.locator('xpath=ancestor::*[@role="row"][1]').getByRole('checkbox').check()
    await expect(page.getByText('Выбрано: 1', { exact: true })).toBeVisible()
    await line('AG-0001').locator('.ag-group-value').click({ button: 'right' })
    await expect(menu.getByRole('button', { name: 'Развернуть', exact: true })).toBeDisabled()
    await menu.getByRole('button', { name: 'Свернуть', exact: true }).click()
    await expect(joint).toHaveCount(0)
    await expect(line('AG-0002')).toHaveAttribute('aria-expanded', 'true')
    await page.waitForLoadState('networkidle')
    {
      // The journal's user scroll surface is the document. Open the menu once
      // the synchronized viewport has reached that position, not mid-scroll.
      await page.evaluate(() => window.scrollTo(0, document.querySelector('.journal-page-track')!.getBoundingClientRect().top + scrollY + 1000))
      await expect.poll(() => page.locator('.ag-grid-viewport').evaluate(viewport => viewport.scrollTop)).toBe(1000)
    }
    await line('AG-0015').locator('.ag-group-value').click({ button: 'right' })
    await menu.getByRole('button', { name: 'Свернуть все', exact: true }).click()
    await expect(root).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.ag-row.ag-row-group.ag-row-level-1')).toHaveCount(0)
    await expect(page.getByText('Выбрано: 1', { exact: true })).toBeVisible()
    // Focus returns to the surviving root after collapsing from a nested group.
    await page.keyboard.press('Enter')
    await expect(root).toHaveAttribute('aria-expanded', 'true')
    await expect(line('AG-0002')).toHaveAttribute('aria-expanded', 'false')
    await root.locator('.ag-group-value').click({ button: 'right' })
    await menu.getByRole('button', { name: 'Развернуть все', exact: true }).click()
    await expect(joint).toBeVisible()
    await expect(joint.locator('xpath=ancestor::*[@role="row"][1]').getByRole('checkbox')).toBeChecked()
    await expect(page.getByRole('searchbox')).toHaveValue(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.waitForLoadState('networkidle')
    {
      // Two expand-all operations and one distant scroll may read visible
      // stores, including stores purged by collapse. They must not enumerate
      // all 250 leaf groups or request the complete report in a single block.
      expect(blocks.every(block => block.end - block.start <= 100)).toBe(true)
      const viewportRows = await page.locator('.ag-grid-viewport').evaluate(element =>
        Math.ceil(element.clientHeight / document.querySelector('.ag-row')!.getBoundingClientRect().height))
      expect(calls.slice(before).filter(name => name.startsWith('readJournalGrid')).length).toBeLessThanOrEqual(4 + 3 * (viewportRows + 16))
    }
    expect(errors).toEqual([])
  })

  test(name('цвета групп и следующего действия сохраняются при перестройке, темах и прокрутке'), async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(PROJECT)
    await expect(page.getByText(loaded(100, 250), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.waitForLoadState('networkidle')
    await revealColumn(page, 'jointNextAction')
    const nextAction = page.getByRole('button', { name: 'F2001', exact: true }).locator('xpath=ancestor::*[@role="row"][1]').locator('[data-joint-next-action-cell]')
    const actionColors = async () => {
      await expect(nextAction).toHaveCount(1)
      await expect(nextAction).toBeVisible()
      return nextAction.evaluate(cell => ({
        text: getComputedStyle(cell.querySelector('span.font-semibold')!).color,
        row: getComputedStyle(cell.closest('[role="row"]')!).backgroundColor,
      }))
    }
    const originalColors = await actionColors()
    for (const id of ['projectTitle', 'groupName', 'line', 'weldingMethod']) {
      await revealColumn(page, id)
      await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    }
    const chips = page.getByRole('list', { name: 'Порядок группировок' })
    const groupRows = page.locator('.ag-row.ag-row-group:not(.ag-row-selected)')
    const expectColors = async () => {
      await expect(groupRows.first()).toBeVisible()
      await expect.poll(() => page.evaluate(() => {
        const palette = Array.from(document.querySelectorAll('.journal-grouping-levels .journal-grouping-chip')).map(chip => getComputedStyle(chip).backgroundColor)
        return Array.from(document.querySelectorAll('.ag-row.ag-row-group:not(.ag-row-selected)')).flatMap(row => {
          const level = Number(row.className.match(/ag-row-level-(\d+)/)?.[1])
          const colors = Array.from(row.classList).filter(name => /^journal-group-tone-\d+$/.test(name))
          const actual = getComputedStyle(row).backgroundColor
          return actual === palette[level] && colors.length === 1 ? [] : [{ label: row.textContent, level, colors, actual, expected: palette[level] }]
        })
      })).toEqual([])
    }
    const expandFirstBranch = async (expectedLevels = 4) => {
      await page.locator('.ag-grid-viewport').evaluate(viewport => { viewport.scrollTop = 0 })
      // AG updates its groups before React publishes the chips. Reading the
      // old three-chip list after adding level four leaves that level closed.
      await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveCount(expectedLevels)
      const levels = await chips.getByRole('button', { name: /^Группировка:/ }).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!))
      const firstValues: Record<string, string> = {
        'Группировка: Проект': PROJECT,
        'Группировка: Группа трубопровода': '(Пусто)',
        'Группировка: Линия': 'AG-0001',
        'Группировка: Способ сварки': 'РАД',
      }
      for (const [level, name] of levels.entries()) {
        // DOM order can differ from display order when AG Grid reuses virtual rows.
        const row = page.locator(`.ag-row.ag-row-group.ag-row-level-${level}:not(.ag-opacity-zero)`)
          .filter({ has: page.locator('.ag-group-value').getByText(firstValues[name], { exact: true }) })
        await expect(row).toBeVisible()
        if (await row.getAttribute('aria-expanded') !== 'true') await row.locator('.ag-group-contracted').click()
        await expect(row).toHaveAttribute('aria-expanded', 'true')
      }
      await expectColors()
      await revealColumn(page, 'jointNextAction')
      await expect.poll(actionColors).toEqual(originalColors)
    }
    await expandFirstBranch()
    for (const theme of ['Классическая', 'Нейтральная', 'Светлая']) {
      await page.getByRole('button', { name: 'Настроить вид' }).click()
      await page.getByRole('tab', { name: 'Темы', exact: true }).click()
      await page.getByRole('radio', { name: new RegExp(theme) }).click()
      await page.keyboard.press('Escape')
      await expectColors()
      await expect.poll(actionColors).toEqual(originalColors)
      await page.getByRole('button', { name: 'Настроить вид' }).click()
      await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
      await page.getByRole('switch', { name: 'Чередование строк', exact: true }).click()
      await page.keyboard.press('Escape')
      await expectColors()
      await expect.poll(actionColors).toEqual(originalColors)
    }
    await page.locator('.ag-row.ag-row-group.ag-row-level-0').first().locator('.ag-group-expanded').click()
    await expectColors()
    await expandFirstBranch()
    await page.locator('.ag-grid-viewport').evaluate(viewport => { viewport.scrollTop = 900 })
    await expectColors()
    await page.locator('.ag-grid-viewport').evaluate(viewport => { viewport.scrollTop = 0 })
    await expect.poll(actionColors).toEqual(originalColors)
    await chips.getByRole('button', { name: 'Группировка: Линия', exact: true }).press('Alt+ArrowLeft')
    await expect(chips.getByRole('button', { name: /^Группировка:/ }).nth(1)).toHaveAttribute('aria-label', 'Группировка: Линия')
    await expandFirstBranch()
    await chips.getByRole('button', { name: 'Убрать группировку: Проект', exact: true }).click()
    await expandFirstBranch(3)
    await page.reload()
    await expandFirstBranch(3)
    await page.getByRole('button', { name: 'Снять все группировки', exact: true }).click()
    await expect(groupRows).toHaveCount(0)
    await expect.poll(actionColors).toEqual(originalColors)
    expect(errors).toEqual([])
  })

  if (isWorkflow) test(name('5000 строк на сервере — полный диапазон, отмена расчёта и ограниченные DOM и запросы'), async ({ page }, info) => {
    test.skip(process.env.AUDIT_JOURNAL_GRID !== '1', 'Explicit local browser performance run')
    test.setTimeout(120_000)
    const project = profile.accumulatedProject
    await withLineProgramFixture(db => db.query(`insert into weld_joints (project_title, subtitle_code, line, joint, connection_type, d1, t1, officiality, psto_required, weld_date, has_vik)
      select $1, 'PERF', 'PERF-' || (n % 20), 'F' || (300000 + n), 'С17', 215, 10, 'действующий', $2, $3, $4
      from generate_series(1, 5000) n`, [project, isPsto ? 'да' : null, isWorkflow ? '2026-09-01' : null, report === 'lnk' ? 'да' : null]))
    const calls: string[] = []
    page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
    await page.goto(profile.route)
    await page.getByRole('searchbox').fill(project)
    await expect(page.getByText(loaded(100, 5000), { exact: true })).toBeVisible()
    await waitForGridRows(page)
    await page.getByRole('button', { name: 'Настроить вид' }).click()
    await showAllColumns(page)
    await page.keyboard.press('Escape')
    // Rows are usable while their scoped dispatcher context loads in the
    // background. Finish that setup before attributing RPCs to range gestures.
    await revealColumn(page, 'jointNextAction')
    await expect(page.locator('[data-joint-next-action-cell]').getByRole('button', { name: /^Открыть картину стыка / }).first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    await revealColumn(page, 'd1')
    const viewport = page.locator('.ag-grid-viewport')
    await viewport.evaluate(element => { element.scrollTop = 0 })
    const first = page.locator('.ag-grid-scrolling-rows .ag-row[row-index="0"] [col-id="d1"]')
    await first.click()
    const before = calls.length
    const started = performance.now()
    await page.keyboard.press('ControlOrMeta+Shift+ArrowDown')
    const stats = page.getByLabel('Статистика выделения', { exact: true })
    await expect(stats).toContainText('Количество: 5000')
    await expect(stats).toContainText('Среднее: 215')
    await expect(stats).toContainText('Сумма: 1 075 000')
    const duration = performance.now() - started
    // Begin a wide range, then immediately replace it. No obsolete total may win.
    await page.keyboard.press('ControlOrMeta+a')
    await viewport.evaluate(element => { element.scrollTop = 0 })
    await first.click()
    await expect(stats).toContainText('Количество: 1')
    await expect(stats).toContainText('Сумма: 215')
    await page.waitForLoadState('networkidle')
    const rangeCalls = calls.slice(before)
    expect(rangeCalls.some(name => name.startsWith('summarizeJournalGridRange'))).toBe(true)
    expect(rangeCalls.length).toBeLessThanOrEqual(8)
    // The joint/WDI/date summary accompanies numeric cell statistics. Its
    // existing area RPC must stay bounded too; it is not a full-report refresh.
    expect(rangeCalls.filter(name => name.startsWith('summarizeJournalGridArea_')).length).toBeLessThanOrEqual(2)
    // Ctrl+Shift+Down also reveals the last, previously unloaded block. Its
    // visible next-step cells need a bounded dispatcher context, not a rebuild.
    expect(rangeCalls.filter(name => name.startsWith('getDispatcherTaskContext_')).length).toBeLessThanOrEqual(2)
    expect(rangeCalls.every(name => /^(readJournalGrid|summarizeJournalGridRange|summarizeJournalGridArea|getDispatcherTaskContext)_/.test(name)), rangeCalls.join(', ')).toBe(true)
    const rendered = await page.locator('.ag-grid-scrolling-rows .ag-row').count()
    expect(rendered).toBeLessThan(60)
    console.info(`${profile.prefix} accumulated rows:`, JSON.stringify({ rows: 5000, rangeTotalMs: Math.round(duration), renderedRows: rendered, extraRpc: calls.length - before }))
    await info.attach('accumulated-rows.json', { body: JSON.stringify({ rows: 5000, rangeTotalMs: duration, renderedRows: rendered }), contentType: 'application/json' })
  })

}
