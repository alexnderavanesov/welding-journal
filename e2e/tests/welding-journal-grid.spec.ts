import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'

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

const PROJECT = 'E2E AG journal'
test.beforeEach(async ({ page }) => {
  const diagnostics: string[] = []
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type()) && /AG Grid:/.test(message.text())) diagnostics.push(message.text())
  })
  page.on('pageerror', error => diagnostics.push(error.message))
  Object.assign(page, { journalDiagnostics: diagnostics })
})
test.afterEach(async ({ page }) => {
  expect((page as Page & { journalDiagnostics: string[] }).journalDiagnostics).toEqual([])
})
test.beforeAll(async () => {
  await withE2eDatabase(client => client.query(`
    insert into weld_joints (project_title, subtitle_code, line, joint, weld_date, connection_type,
      officiality, revision_actuality, has_vik, stamp_1_k, d1, t1,
      element_1, element_2, material_1, material_2, welding_method, material_group, responsible, isometry, spool)
    select $1, 'AG', 'AG-' || lpad(n::text, 4, '0'), 'F' || (2000+n), '2026-09-01', 'С17',
      'действующий', 'актуальная', 'да', 'K1', 215, 10.25,
      'Труба', 'Отвод 90°', '12Х18Н10Т', '12Х18Н10Т', 'РАД', 'М11', 'Ответственный за сварку', 'ISO-AG-2026-' || n, 'SPL-' || n
      from generate_series(1,250) n where not exists (select 1 from weld_joints where project_title = $1)
  `, [PROJECT]))
})

test('AG журнал: серверный поиск, фильтр всей выборки, ограниченная загрузка и виртуализация', async ({ page }) => {
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  const count = (name: string) => calls.filter(value => value.startsWith(name + '_')).length
  await page.goto('/journal')
  await expect(page.locator('[data-welding-journal-grid] .ag-root')).toBeVisible()
  await page.waitForLoadState('networkidle')
  // Startup can publish the dispatcher revision once and refresh the first page.
  // The grid itself must neither request facets nor drain subsequent pages.
  const initialPages = count('listWeldingJournalPage')
  expect(initialPages).toBeLessThanOrEqual(2)
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(count('listWeldColumnFilterOptions')).toBe(0)
  expect(count('listWeldingJournalPage')).toBe(initialPages + 1)
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
  await expect(page.getByText('Загружено: 1 из 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'F2250', exact: true })).toBeVisible()
  await expect(filter).toBeVisible()
  expect(count('listWeldColumnFilterOptions')).toBe(1)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click()
  await expect(page.getByText(/Загружено: 100 из/)).toBeVisible()
  expect(errors).toEqual([])
})

test('AG журнал: родная картина стыка, ПКМ с иконками и прежние таблицы ЛНК/ПСТО', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('E2E проект')
  const joint = page.getByRole('button', { name: 'F1', exact: true })
  await expect(joint).toBeVisible()
  await joint.click()
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка F1', exact: true }) })
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
  await page.getByRole('button', { name: 'Редактировать стык', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'ЛНК', exact: true }).click()
  await expect(page.locator('[data-welding-journal-grid]')).toHaveCount(0)
  await expect(page.locator('table').first()).toBeVisible()
  await page.getByRole('button', { name: 'ПСТО и ТВМТ', exact: true }).click()
  await expect(page.locator('[data-welding-journal-grid]')).toHaveCount(0)
  await expect(page.locator('table').first()).toBeVisible()
  expect(errors).toEqual([])
})

test('AG журнал: оформление и сохранённые виды без потери фильтра', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
  const appearance = page.getByRole('dialog', { name: 'Настройка вида журнала' })
  await appearance.getByRole('combobox', { name: 'Плотность строк' }).click()
  await appearance.getByRole('option', { name: /Компактно/ }).click()
  await appearance.getByRole('switch', { name: 'Вертикальная сетка' }).check()
  await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
  await page.getByRole('tab', { name: 'Столбцы', exact: true }).click()
  await page.getByRole('dialog', { name: 'Настройка вида журнала' }).getByRole('checkbox', { name: 'Следующий шаг' }).uncheck()
  await page.getByRole('tab', { name: 'Столбцы', exact: true }).click()
  await page.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  const views = page.getByRole('dialog', { name: 'Настройка вида журнала' })
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
  await expect(page.getByRole('dialog', { name: 'Настройка вида журнала' }).getByRole('checkbox', { name: 'Следующий шаг' })).not.toBeChecked()
  await page.getByRole('tab', { name: 'Столбцы', exact: true }).click()
  await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Открыть прежнюю таблицу для сравнения' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })).toHaveValue(PROJECT)
  await expect(page.locator('.journal-density-compact')).toBeVisible()
})

test('AG журнал: клавиатура, копирование диапазона и серверная сортировка', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  const projectCell = page.locator('.ag-grid-scrolling-rows .ag-row[row-index="0"] [col-id="projectTitle"]')
  await projectCell.click()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`Проект\tШифр\r\n${PROJECT}\tAG\r\n${PROJECT}\tAG`)
  await projectCell.click()
  await page.keyboard.press('Tab')
  await expect(page.locator('.ag-cell-focus')).toHaveAttribute('col-id', 'subtitleCode')
  await page.keyboard.press('F2')
  await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toBeVisible()
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
})

test('AG журнал: прокрутка оставляет только шапку, подгружает одну порцию и сохраняет выбор', async ({ page }, info) => {
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.locator('.ag-grid-scrolling-rows .ag-row[row-index="0"]').getByRole('checkbox').check()
  await expect(page.getByText('Выбрано: 1', { exact: true })).toBeVisible()
  await page.locator('.ag-grid-viewport').hover()
  await page.mouse.wheel(0, 700)
  await expect.poll(() => page.locator('.journal-grid-frame').evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(2)
  expect((await page.locator('[data-journal-toolbar]').boundingBox())!.y).toBeLessThan(0)
  await page.mouse.wheel(0, 500)
  await expect.poll(() => page.locator('.ag-grid-viewport').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  expect((await page.locator('.ag-header').boundingBox())!.y).toBeGreaterThanOrEqual(-1)
  await page.screenshot({ path: info.outputPath('journal-header-only.png') })
  await page.locator('.ag-grid-viewport').evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(page.getByText('Загружено: 200 из 250', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Загружено: 200 из 250', { exact: true })).toBeVisible()
  await expect(page.getByText('Выбрано: 1', { exact: true })).toBeVisible()
  await page.locator('.ag-grid-viewport').evaluate(element => { element.scrollTop = 0 })
  await expect(page.locator('.ag-grid-scrolling-rows .ag-row[row-index="0"]').getByRole('checkbox')).toBeChecked()
  // Horizontal scrolling does not load another server page or unpin the identity.
  const line = page.locator('.ag-grid-scrolling-rows .ag-row[row-index="0"] [col-id="line"]')
  const left = (await line.boundingBox())!.x
  await page.locator('.ag-body-horizontal-scroll-viewport').evaluate(element => { element.scrollLeft = 3000 })
  expect((await line.boundingBox())!.x).toBe(left)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Загружено: 200 из 250', { exact: true })).toBeVisible()
  // Returning to page top re-enables the toolbar handoff for the next gesture.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.locator('.ag-grid-viewport').hover()
  await page.mouse.wheel(0, 700)
  await expect.poll(() => page.locator('.journal-grid-frame').evaluate(e => e.getBoundingClientRect().top)).toBeLessThan(2)
})

test('AG журнал: верхняя панель уходит постепенно, без скачка при передаче прокрутки строкам', async ({ page }, info) => {
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const viewport = page.locator('.ag-grid-viewport')
  const initialBox = (await viewport.boundingBox())!
  // hover() scrolls the tall viewport into view itself and hides part of the
  // heading before the gesture. Move the pointer without changing the page.
  await page.mouse.move(initialBox.x + initialBox.width / 2, initialBox.y + 140)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await page.evaluate(() => {
    const state = { active: true, samples: [] as { page: number; rows: number; time: number }[] }
    const sample = () => {
      state.samples.push({ page: scrollY, rows: document.querySelector('.ag-grid-viewport')!.scrollTop, time: performance.now() })
      if (state.active) requestAnimationFrame(sample)
    }
    Object.assign(window, { journalTransition: state }); sample()
  })
  const headingHeight = await page.locator('.journal-grid-frame').evaluate(element => element.getBoundingClientRect().top)
  await page.mouse.wheel(0, headingHeight + 60)
  // Wait for the sampler to observe the completed movement. The live DOM can
  // already be at 60px while its latest RAF sample still contains 59px.
  await expect.poll(() => page.evaluate(() => {
    const state = (window as unknown as { journalTransition: { samples: { page: number; rows: number }[] } }).journalTransition
    const last = state.samples.at(-1)
    return last ? last.page + last.rows : 0
  })).toBeCloseTo(headingHeight + 60, 0)
  const samples = await page.evaluate(() => {
    const state = (window as unknown as { journalTransition: { active: boolean; samples: { page: number; rows: number; time: number }[] } }).journalTransition
    state.active = false
    return state.samples
  })
  const intermediate = new Set(samples.filter(s => s.page > 0 && s.page < headingHeight - 1).map(s => s.page))
  await info.attach('heading-transition.json', { body: JSON.stringify({ headingHeight, samples }), contentType: 'application/json' })
  // A healthy steady-grid FPS does not prove this: the old bridge moved the
  // entire heading and the remaining wheel distance in a single frame.
  expect(intermediate.size).toBeGreaterThanOrEqual(3)
  const offsets = samples.map(s => s.page + s.rows)
  const maxStep = Math.max(...offsets.slice(1).map((value, i) => value - offsets[i]))
  console.info('Journal heading transition:', JSON.stringify({ headingHeight, intermediatePositions: intermediate.size, maxStep, distance: offsets.at(-1) }))
  expect(maxStep).toBeLessThan(headingHeight * .65)
  expect(offsets.at(-1)).toBeCloseTo(headingHeight + 60, 0)
  // One uninterrupted native gesture must continue into rows. Merely toggling
  // overflow at the boundary leaves Chromium's gesture latched to the page.
  await viewport.evaluate(element => { element.scrollTop = 0 })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const box = (await viewport.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + 140, yDistance: -800, speed: 1200, gestureSourceType: 'mouse' })
  await cdp.detach()
  await expect.poll(() => page.evaluate(() => scrollY + document.querySelector('.ag-grid-viewport')!.scrollTop)).toBeGreaterThanOrEqual(798)
  expect(await page.evaluate(() => scrollY + document.querySelector('.ag-grid-viewport')!.scrollTop)).toBeLessThanOrEqual(802)
})

test('AG журнал: непрерывный жест сразу становится штатным после ухода панели, без движения вверх', async ({ page }, info) => {
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const calls: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    const events: { top: number; prevented: boolean; time: number }[] = []
    Object.assign(window, { journalHandoffEvents: events })
    window.addEventListener('wheel', event => {
      events.push({ top: document.querySelector('.journal-grid-frame')!.getBoundingClientRect().top,
        prevented: event.defaultPrevented, time: performance.now() })
    }, { passive: true })
  })
  const viewport = page.locator('.ag-grid-viewport')
  const box = (await viewport.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  try {
    // The previous test checked distance after the gesture ended. It missed
    // a bridge which kept intercepting every input while the gesture continued.
    await cdp.send('Input.synthesizeScrollGesture', {
      x: box.x + box.width / 2, y: box.y + 140,
      yDistance: -1600, speed: 1000, gestureSourceType: 'mouse',
    })
    await expect.poll(() => page.evaluate(() => scrollY + document.querySelector('.ag-grid-viewport')!.scrollTop)).toBeGreaterThanOrEqual(1598)
    const events = await page.evaluate(() => (window as unknown as {
      journalHandoffEvents: { top: number; prevented: boolean; time: number }[]
    }).journalHandoffEvents)
    const afterBoundary = events.filter(event => event.top <= 1)
    await info.attach('continuous-handoff.json', { body: JSON.stringify(events), contentType: 'application/json' })
    expect(afterBoundary.length).toBeGreaterThan(20)
    expect(afterBoundary.filter(event => event.prevented)).toHaveLength(0)
    // Native input and the finite tail must conserve the gesture distance.
    expect(await page.evaluate(() => scrollY + document.querySelector('.ag-grid-viewport')!.scrollTop)).toBeLessThanOrEqual(1602)
    expect(calls).toEqual([])
    // A brief reversal must not be needed to unlock smooth downward scrolling.
    const before = await viewport.evaluate(element => element.scrollTop)
    await cdp.send('Input.synthesizeScrollGesture', {
      x: box.x + box.width / 2, y: 250, yDistance: 12, speed: 300, gestureSourceType: 'mouse',
    })
    await cdp.send('Input.synthesizeScrollGesture', {
      x: box.x + box.width / 2, y: 250, yDistance: -300, speed: 800, gestureSourceType: 'mouse',
    })
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(before + 286)
  } finally { await cdp.detach() }
})

test('AG журнал: мелкие движения трекпада не теряются при уходе верхней панели', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const movement = await page.locator('.ag-grid-viewport').evaluate(async viewport => {
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await frame(); await frame()
    const start = window.scrollY + viewport.scrollTop
    // Chromium rounds individual JS scrollBy(0.2) calls to zero. Trackpad
    // momentum still has to accumulate across frames and reach the boundary.
    for (let index = 0; index < 25; index++) {
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: .2, bubbles: true, cancelable: true }))
      await frame()
    }
    // Include the final short motion tail, not only the input delivery period.
    await new Promise(resolve => setTimeout(resolve, 150))
    return window.scrollY + viewport.scrollTop - start
  })
  expect(movement).toBeGreaterThanOrEqual(4)
  expect(movement).toBeLessThanOrEqual(6)
  await page.locator('.ag-grid-viewport').evaluate(viewport => {
    const frame = document.querySelector('.journal-grid-frame')!
    const remaining = frame.getBoundingClientRect().top
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaX: 8, deltaY: remaining + 40, bubbles: true, cancelable: true }))
  })
  await expect.poll(() => page.locator('.ag-grid-viewport').evaluate(viewport => viewport.scrollTop)).toBe(40)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const handoff = await page.locator('.ag-grid-viewport').evaluate(viewport => ({
    top: document.querySelector('.journal-grid-frame')!.getBoundingClientRect().top,
    rows: viewport.scrollTop, horizontal: viewport.scrollLeft,
  }))
  expect(handoff.top).toBeLessThanOrEqual(1)
  expect(handoff.rows).toBeGreaterThanOrEqual(39)
  expect(handoff.rows).toBeLessThanOrEqual(41)
  expect(handoff.horizontal).toBe(8)
  // After the movement settles the listener is gone: the next event is native.
  expect(await page.locator('.ag-grid-viewport').evaluate(viewport => viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true }),
  ))).toBe(true)
})

test('AG журнал: уход панели можно остановить, уменьшение движения отключает анимацию', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  const viewport = page.locator('.ag-grid-viewport')
  for (const intent of ['reverse', 'reverse-handoff', 'pointer', 'key'] as const) {
    const result = await viewport.evaluate(async (element, intent) => {
      window.scrollTo({ top: 0, behavior: 'instant' }); element.scrollTop = 0
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 300, bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, intent === 'reverse-handoff' ? 85 : 40))
      const before = scrollY + element.scrollTop
      const top = document.querySelector('.journal-grid-frame')!.getBoundingClientRect().top
      if (intent === 'reverse' || intent === 'reverse-handoff') element.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, bubbles: true, cancelable: true }))
      if (intent === 'pointer') element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      if (intent === 'key') element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 150))
      return { before, after: scrollY + element.scrollTop, top }
    }, intent)
    expect(result.before).toBeGreaterThan(0)
    if (intent === 'reverse-handoff') expect(result.top).toBeLessThanOrEqual(1)
    expect(result.after).toBe(result.before)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await viewport.evaluate(async element => {
    window.scrollTo({ top: 0, behavior: 'instant' }); element.scrollTop = 0
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await frame(); await frame()
    const distance = document.querySelector('.journal-grid-frame')!.getBoundingClientRect().top + 40
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: distance, bubbles: true, cancelable: true }))
    await frame()
    return { distance, actual: scrollY + element.scrollTop }
  })
  expect(reduced.actual).toBe(reduced.distance)
})

test('AG журнал: только своё ПКМ, русский заголовок, Escape и стабильный фильтр с колесом', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
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
  await expect(page.getByText('Загружено: 1 из 1', { exact: true })).toBeVisible()
  await expect(filter).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(filter).toHaveCount(0)
  await expect(page.getByText('Загружено: 1 из 1', { exact: true })).toBeVisible()
  // A popup no longer owns Escape; the report's original reset behavior takes over.
  await page.getByRole('gridcell', { name: 'AG-0250', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('searchbox')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Сбросить', exact: true })).toHaveCount(0)
})

test('AG журнал: resize, порция, компактная панель и однократный Escape из редактирования', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  const toolbar = page.locator('[data-journal-toolbar]')
  await expect(toolbar.getByRole('button', { name: 'Настроить вид' })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: /^(Разделы|Наборы|Столбцы|Виды|Оформление)$/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Настроить вид' }).click()
  const panel = page.getByRole('dialog', { name: 'Настройка вида журнала' })
  const box = (await panel.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await expect(panel.getByLabel('Набор столбцов')).toHaveCount(0)
  await panel.getByRole('checkbox', { name: 'Раздел: Материалы', exact: true }).uncheck()
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Показать все' }).click()
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
  expect(await size.evaluate(e => parseFloat(getComputedStyle(e).paddingRight))).toBeGreaterThanOrEqual(28)
  await expect(size).not.toHaveCSS('background-image', 'none')
  await size.selectOption('300')
  await expect(page.getByText('Загружено: 250 из 250', { exact: true })).toBeVisible()
  // Open by F2 while a field has suggestions, then close the editor in one key press.
  await page.locator('.ag-row[row-index="0"] [col-id="subtitleCode"]').click()
  await page.keyboard.press('F2')
  await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('textbox', { name: 'Линия', exact: true }).fill('AG-')
  await expect(page.getByRole('dialog').getByRole('button', { name: /^AG-000/ }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toHaveCount(0)
  await expect(page.getByRole('searchbox')).toHaveValue(PROJECT)
})

test('AG журнал: прокрутка 111 столбцов без фоновых запросов и лишних DOM-строк', async ({ page }, info) => {
  const calls: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Настроить вид' }).click()
  await page.getByRole('button', { name: 'Показать все', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('combobox', { name: 'Размер порции строк' }).selectOption('300')
  await expect(page.getByText('Загружено: 250 из 250', { exact: true })).toBeVisible()
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
  console.info('Journal scroll:', JSON.stringify(measurement))
  await info.attach('scroll-measurement.json', { body: JSON.stringify(measurement), contentType: 'application/json' })
  expect(measurement.frames).toBeGreaterThan(20)
  expect(measurement.p95).toBeLessThan(35)
  expect(measurement.renderedRows).toBeLessThan(60)
  expect(measurement.cells).toBeLessThan(1500)
  expect(calls.slice(before)).toEqual([])
})

test('AG журнал: единый список значений без условий и иерархия дат', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  const lineFilter = page.getByRole('dialog', { name: 'Фильтр: Линия' })
  await expect(lineFilter.getByRole('tab')).toHaveCount(0)
  await lineFilter.getByLabel('Найти значение фильтра').fill('AG-0002')
  await lineFilter.getByRole('checkbox').check()
  await expect(page.getByText('Загружено: 1 из 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'F2002', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  await expect(lineFilter.getByRole('checkbox')).toBeChecked()
  await lineFilter.getByRole('button', { name: 'Сбросить фильтр' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Настроить вид' }).click()
  await page.getByRole('button', { name: 'Показать все', exact: true }).click()
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


test('AG журнал: меню столбца сортирует весь отчёт, группирует загруженное и открывает настройки', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  const header = page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-text')
  await header.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
  await expect(page.getByRole('button', { name: 'F2250', exact: true }).locator('xpath=ancestor::*[@role="row"]')).toHaveAttribute('row-index', '0')
  await page.locator('.ag-header-cell[col-id="projectTitle"] .ag-header-cell-text').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать загруженные по «Проект»/ }).click()
  await expect(page.getByRole('button', { name: 'Группировка: Проект', exact: true })).toBeVisible()
  const group = page.locator('.ag-row-group').first()
  await expect(group).toContainText(PROJECT)
  await expect(group).toContainText('(100)')
  await group.locator('.ag-group-contracted').click()
  await expect(page.getByRole('button', { name: 'F2250', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Снять все группировки', exact: true }).click()
  await expect(page.locator('.ag-row-group')).toHaveCount(0)
  await page.locator('.ag-grid-viewport').hover()
  await page.mouse.wheel(0, 500)
  await expect.poll(() => page.locator('[data-journal-toolbar]').evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThan(1)
  await header.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Выбрать столбцы', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Настройка вида журнала' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Столбцы', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect((await page.getByRole('dialog', { name: 'Настройка вида журнала' }).boundingBox())!.y).toBeGreaterThanOrEqual(0)
  expect(errors).toEqual([])
})

test('AG журнал: F2/Enter выбирают строки и открывают следующий шаг, стрелки возвращаются после меню и карточки', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
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
  await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 100')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Статистика выделения')).not.toContainText('Выбрано:')
  const line = first.locator('[col-id="line"]')
  await line.click({ button: 'right' })
  await expect(page.getByRole('button', { name: 'Картина стыка', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('searchbox')).toHaveValue(PROJECT)
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.ag-cell-focus').locator('xpath=ancestor::*[@role="row"]')).toHaveAttribute('row-index', '1')
  await page.locator('.ag-row[row-index="0"] [col-id="subtitleCode"]').click()
  await page.keyboard.press('F2')
  await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toHaveCount(0)
  await expect(page.locator('.ag-cell-focus')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.ag-cell-focus').locator('xpath=ancestor::*[@role="row"]')).toHaveAttribute('row-index', '1')
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

test('AG журнал: оформление, статистика диапазона, числовой фильтр и Tab через системные поля', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  const searchBox = (await page.getByRole('searchbox').boundingBox())!
  const settingsButton = (await page.getByRole('button', { name: 'Настроить вид' }).boundingBox())!
  expect(settingsButton.x - searchBox.x - searchBox.width).toBeLessThan(20)
  await page.getByRole('button', { name: 'Настроить вид' }).click()
  await page.getByRole('button', { name: 'Показать все', exact: true }).click()
  await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Настройка вида журнала' })
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
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
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
  // row's selection, then its first editable field (the line).
  await revealColumn(page, 'finalStatus')
  await page.locator('.ag-row[row-index="0"] [col-id="finalStatus"]').click({ position: { x: 2, y: 5 } })
  await page.keyboard.press('Tab')
  const focused = await page.locator('.ag-cell-focus').getAttribute('col-id')
  expect(focused).toMatch(/^ag-Grid-SelectionColumn/)
  await page.keyboard.press('Tab')
  await expect(page.locator('.ag-cell-focus')).toHaveAttribute('col-id', 'line')
  await page.keyboard.press('F2')
  await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('AG журнал: сброс возвращает исходный порядок, видимость и закрепление даже после перезагрузки', async ({ page }) => {
  await page.goto('/journal')
  await expect(page.locator('.ag-grid-pinned-left-cells [col-id="line"]').first()).toBeVisible()
  await expect(page.locator('.ag-grid-pinned-left-cells [col-id="joint"]').first()).toBeVisible()
  await expect(page.locator('.ag-grid-pinned-right-cells [col-id="finalStatus"]').first()).toBeVisible()
  const reset = async () => {
    await page.locator('.ag-header-group-cell').filter({ hasText: 'Стык' }).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Сбросить столбцы', exact: true }).click()
  }
  await reset()
  const canonical = await page.evaluate(() => JSON.parse(localStorage.getItem('welding-journal-ag-grid:v1')!).columns)
  expect(canonical.filter((c: { pinned: string }) => c.pinned === 'left').map((c: { colId: string }) => c.colId)).toEqual(['ag-Grid-SelectionColumn', 'line', 'joint'])
  expect(canonical.filter((c: { pinned: string }) => c.pinned === 'right').map((c: { colId: string }) => c.colId)).toEqual(['finalStatus'])
  await page.locator('.ag-header-group-cell').filter({ hasText: 'Проект' }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Скрыть раздел', exact: true }).click()
  await expect(page.locator('.ag-header-cell[col-id="line"]')).toHaveCount(0)
  await expect(page.locator('.ag-header-cell[col-id="projectTitle"]')).toHaveCount(0)
  await reset()
  await expect(page.locator('.ag-header-cell[col-id="line"]')).toBeVisible()
  await page.locator('.ag-header-cell[col-id="subtitleCode"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true }).click()
  await expect(page.locator('.ag-header-cell[col-id="subtitleCode"]')).toHaveCount(0)
  // A saved custom order must not become the reset baseline on the next mount.
  await page.evaluate(() => {
    const key = 'welding-journal-ag-grid:v1', value = JSON.parse(localStorage.getItem(key)!)
    value.columns.reverse()
    for (const column of value.columns) if (!column.colId.startsWith('ag-')) { column.width = 190; column.pinned = null }
    localStorage.setItem(key, JSON.stringify(value))
  })
  await page.reload()
  await page.getByRole('button', { name: 'Настроить вид' }).click()
  await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
  await page.getByRole('button', { name: 'Сбросить столбцы', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ag-grid-pinned-left-cells [col-id="line"]').first()).toBeVisible()
  await expect(page.locator('.ag-grid-pinned-right-cells [col-id="finalStatus"]').first()).toBeVisible()
  await page.locator('.ag-grid-viewport').evaluate(e => { e.scrollLeft = 0 })
  await expect(page.locator('.ag-header-cell[col-id="subtitleCode"]')).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('welding-journal-ag-grid:v1')!).columns)).toEqual(canonical)
  await page.reload()
  await expect(page.locator('.ag-grid-pinned-right-cells [col-id="finalStatus"]').first()).toBeVisible()
})

test('AG журнал: булавки и закрепление только через ПКМ, порядок по-прежнему меняется мышью', async ({ page }) => {
  await page.goto('/journal')
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

test('AG журнал: темы сохраняются с видом, а группы и счётчики выровнены во всех темах', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.locator('.ag-header-cell[col-id="projectTitle"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать загруженные по «Проект»/ }).click()
  const group = page.locator('.ag-full-width-row.ag-row-group').first()
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
  await group.focus()
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

test('AG журнал: ширина следует за курсором без запросов и сохраняется после отпускания', async ({ page }, info) => {
  const calls: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
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
  console.info('Journal resize: 48 samples, maximum cursor/column deviation', Math.max(...samples.map(s => Math.abs(s.width - initialWidth - s.delta))))
})

test('AG журнал: вложенные группы выбирают стыки, поддерживают частичный выбор и сохраняют порядок без скачка панели', async ({ page }, info) => {
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const layout = () => page.evaluate(() => ['[data-journal-toolbar]', '.journal-grid-frame', '[data-journal-footer]'].map(selector => {
    const box = document.querySelector(selector)!.getBoundingClientRect()
    return { top: box.top + window.scrollY, height: box.height }
  }))
  const alignedDispatcher = async () => {
    const panel = (await page.getByLabel('Диспетчер задач', { exact: true }).boundingBox())!
    const grid = (await page.locator('.journal-grid-frame').boundingBox())!
    expect(Math.abs(panel.x - grid.x)).toBeLessThan(1)
    expect(Math.abs(panel.x + panel.width - grid.x - grid.width)).toBeLessThan(1)
  }
  await alignedDispatcher()
  const initial = await layout(), before = calls.length
  for (const [id, name] of [['projectTitle', 'Проект'], ['line', 'Линия']]) {
    await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: `Сгруппировать загруженные по «${name}»`, exact: true }).click()
  }
  const chips = page.locator('[data-journal-toolbar]').getByRole('list', { name: 'Порядок группировок' })
  await expect(page.locator('[data-journal-footer] .journal-grouping')).toHaveCount(0)
  await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Проект', 'Линия'])
  expect(await layout()).toEqual(initial)
  const chipsBox = (await chips.boundingBox())!, searchBox = (await page.getByRole('searchbox').boundingBox())!
  expect(chipsBox.x + chipsBox.width).toBeLessThan(searchBox.x)
  expect(Math.abs(chipsBox.y + chipsBox.height / 2 - searchBox.y - searchBox.height / 2)).toBeLessThan(2)
  await page.waitForLoadState('networkidle')
  expect(calls.slice(before)).toEqual([])
  const parent = page.locator('.ag-full-width-row.ag-row-level-0').first()
  const selectAll = page.locator('.ag-header-cell').getByRole('checkbox')
  await selectAll.check()
  await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 100')
  await expect(parent.getByRole('checkbox')).toBeChecked()
  await selectAll.uncheck()
  await parent.getByRole('checkbox').press('F2')
  await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 100')
  await expect(parent).toHaveAttribute('aria-expanded', 'false')
  await expect(parent.getByRole('checkbox')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Статистика выделения')).not.toContainText('Выбрано:')
  await parent.locator('.ag-group-contracted').click()
  const child = page.locator('.ag-full-width-row.ag-row-level-1').first()
  const chipColors = await chips.locator('.journal-grouping-chip').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor))
  expect(new Set(chipColors).size).toBe(2)
  // Expansion can replace the full-width renderer; wait for the connected row.
  await expect(parent).toHaveCSS('background-color', chipColors[0])
  await expect(child).toHaveCSS('background-color', chipColors[1])
  await child.getByRole('checkbox').check()
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
  await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 100')
  await selectAll.uncheck()
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
  await expect(page.locator('.ag-full-width-row.ag-row-group')).toHaveCount(0)
  await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
  await expect.poll(async () => (await page.locator('.journal-grid-frame').boundingBox())!.x).toBeLessThan(100)
  await alignedDispatcher()
  await page.setViewportSize({ width: 1000, height: 900 })
  await alignedDispatcher()
  const narrow = await layout()
  for (const [id, name] of [['line', 'Линия'], ['projectTitle', 'Проект'], ['subtitleCode', 'Шифр'], ['groupName', 'Группа трубопровода']]) {
    await revealColumn(page, id)
    await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: `Сгруппировать загруженные по «${name}»`, exact: true }).click()
    expect(await layout()).toEqual(narrow)
  }
  await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveCount(4)
  expect(await chips.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await page.setViewportSize({ width: 1600, height: 1000 })
  const beforeWideDrag = await layout()
  const longLabel = chips.getByRole('button', { name: 'Группировка: Группа трубопровода', exact: true })
  await longLabel.dragTo(chips.getByRole('button', { name: 'Группировка: Линия', exact: true }))
  await expect(chips.getByRole('button', { name: /^Группировка:/ })).toHaveText(['Группа трубопровода', 'Линия', 'Проект', 'Шифр'])
  expect(await layout()).toEqual(beforeWideDrag)
  await page.getByRole('button', { name: 'Настроить вид' }).click()
  await expect(page.getByRole('dialog', { name: 'Настройка вида журнала' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Настройки таблицы' }).getByRole('tab')).toHaveText(['Столбцы', 'Оформление', 'Темы', 'Мои виды'])
  expect(errors).toEqual([])
})

test('AG журнал: прежнее условие сохранённого вида видно и заменяется списком, бейдж открывает картину стыка', async ({ page }) => {
  await page.goto('/journal')
  await expect(page.locator('[data-welding-journal-grid] .ag-root')).toBeVisible()
  await page.evaluate(project => {
    const key = 'welding-report-view:v1:weldingJournal'
    const value = JSON.parse(localStorage.getItem(key)!)
    value.savedViews.push({ id: 'legacy-text-filter', name: 'Прежний фильтр', snapshot: {
      hiddenFieldKeys: [], collapsedSections: [], sort: null, columnFilters: { projectTitle: '=' + project, line: '=AG-0002' },
    } })
    localStorage.setItem(key, JSON.stringify(value))
  }, PROJECT)
  await page.reload()
  await page.getByRole('button', { name: 'Настроить вид' }).click()
  await page.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await page.getByRole('button', { name: /^Прежний фильтр Фильтров/ }).click()
  await expect(page.getByRole('dialog', { name: 'Настройка вида журнала' })).toHaveCount(0)
  await expect(page.getByText('Загружено: 1 из 1', { exact: true })).toBeVisible()
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
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
})

test('AG журнал: ПКМ группы сворачивает и разворачивает один уровень или все, сохраняя выбор и фильтр', async ({ page }) => {
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const before = calls.length
  for (const id of ['projectTitle', 'line']) {
    await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Сгруппировать загруженные по/ }).click()
  }
  const root = page.locator('.ag-full-width-row.ag-row-group.ag-row-level-0')
  const line = (name: string) => page.locator('.ag-full-width-row.ag-row-group.ag-row-level-1:not(.ag-opacity-zero)')
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
  await page.locator('.ag-grid-viewport').evaluate(viewport => { viewport.scrollTop = 1000 })
  await line('AG-0015').locator('.ag-group-value').click({ button: 'right' })
  await menu.getByRole('button', { name: 'Свернуть все', exact: true }).click()
  await expect(root).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.ag-full-width-row.ag-row-level-1')).toHaveCount(0)
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
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(calls.slice(before)).toEqual([])
  expect(errors).toEqual([])
})

test('AG журнал: цвета групп и следующего действия сохраняются при перестройке, темах и прокрутке', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Загружено: 100 из 250', { exact: true })).toBeVisible()
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
    await page.getByRole('menuitem', { name: /^Сгруппировать загруженные по/ }).click()
  }
  const chips = page.getByRole('list', { name: 'Порядок группировок' })
  const groupRows = page.locator('.ag-full-width-row.ag-row-group:not(.ag-row-selected)')
  const expectColors = async () => {
    await expect(groupRows.first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const palette = Array.from(document.querySelectorAll('.journal-grouping-levels .journal-grouping-chip')).map(chip => getComputedStyle(chip).backgroundColor)
      return Array.from(document.querySelectorAll('.ag-full-width-row.ag-row-group:not(.ag-row-selected)')).flatMap(row => {
        const level = Number(row.className.match(/ag-row-level-(\d+)/)?.[1])
        const colors = Array.from(row.classList).filter(name => /^journal-group-tone-\d+$/.test(name))
        const actual = getComputedStyle(row).backgroundColor
        return actual === palette[level] && colors.length === 1 ? [] : [{ label: row.textContent, level, colors, actual, expected: palette[level] }]
      })
    })).toEqual([])
  }
  const expandFirstBranch = async () => {
    await page.locator('.ag-grid-viewport').evaluate(viewport => { viewport.scrollTop = 0 })
    const levels = await chips.getByRole('button', { name: /^Группировка:/ }).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!))
    const firstValues: Record<string, string> = {
      'Группировка: Проект': PROJECT,
      'Группировка: Группа трубопровода': '(Пусто)',
      'Группировка: Линия': 'AG-0001',
      'Группировка: Способ сварки': 'РАД',
    }
    for (const [level, name] of levels.entries()) {
      // DOM order can differ from display order when AG Grid reuses virtual rows.
      const row = page.locator(`.ag-full-width-row.ag-row-group.ag-row-level-${level}:not(.ag-opacity-zero)`)
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
  await page.locator('.ag-full-width-row.ag-row-level-0').first().locator('.ag-group-expanded').click()
  await expectColors()
  await expandFirstBranch()
  await page.locator('.ag-grid-viewport').evaluate(viewport => { viewport.scrollTop = 900 })
  await expectColors()
  await page.locator('.ag-grid-viewport').evaluate(viewport => { viewport.scrollTop = 0 })
  await expect.poll(actionColors).toEqual(originalColors)
  await chips.getByRole('button', { name: 'Группировка: Линия', exact: true }).press('Alt+ArrowLeft')
  await expandFirstBranch()
  await chips.getByRole('button', { name: 'Убрать группировку: Проект', exact: true }).click()
  await expandFirstBranch()
  await page.reload()
  await expandFirstBranch()
  await page.getByRole('button', { name: 'Снять все группировки', exact: true }).click()
  await expect(groupRows).toHaveCount(0)
  await expect.poll(actionColors).toEqual(originalColors)
  expect(errors).toEqual([])
})

test('AG журнал: 5000 накопленных строк — диапазон, отмена расчёта и ограниченный DOM без запросов', async ({ page }, info) => {
  test.skip(process.env.AUDIT_JOURNAL_GRID !== '1', 'Explicit local browser performance run')
  test.setTimeout(120_000)
  const project = 'E2E AG accumulated rows'
  await withE2eDatabase(db => db.query(`insert into weld_joints (project_title, subtitle_code, line, joint, connection_type, d1, t1, officiality)
    select $1, 'PERF', 'PERF-' || (n % 20), 'F' || (300000 + n), 'С17', 215, 10, 'действующий'
    from generate_series(1, 5000) n`, [project]))
  const calls: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(project)
  await expect(page.getByText('Загружено: 100 из 5000', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Размер порции строк' }).selectOption('1000')
  await expect(page.getByText('Загружено: 1000 из 5000', { exact: true })).toBeVisible()
  for (let loaded = 2000; loaded <= 5000; loaded += 1000) {
    await page.getByRole('button', { name: 'Загрузить ещё', exact: true }).click()
    await expect(page.getByText(`Загружено: ${loaded} из 5000`, { exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Настроить вид' }).click()
  await page.getByRole('button', { name: 'Показать все', exact: true }).click()
  await page.keyboard.press('Escape')
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
  expect(calls.slice(before)).toEqual([])
  const rendered = await page.locator('.ag-grid-scrolling-rows .ag-row').count()
  expect(rendered).toBeLessThan(60)
  console.info('Journal accumulated rows:', JSON.stringify({ rows: 5000, rangeTotalMs: Math.round(duration), renderedRows: rendered, extraRpc: calls.length - before }))
  await info.attach('accumulated-rows.json', { body: JSON.stringify({ rows: 5000, rangeTotalMs: duration, renderedRows: rendered }), contentType: 'application/json' })
})
