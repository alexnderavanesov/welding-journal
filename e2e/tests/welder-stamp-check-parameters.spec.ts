import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'

const stamp = 'TABS'
test.beforeEach(async () => {
  await withE2eDatabase(db => db.query('insert into welder_stamps(naks_stamp,welder_name) values ($1,$2)', [stamp, 'Проверка вкладок']))
  await withE2eDatabase(db => db.query('insert into welder_stamps(naks_stamp,welder_name,naks_permits) values ($1,$2,$3)', ['EXPA', 'Истёкший допуск', JSON.stringify([{ id: 'expired', weldType: 'РД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '500', thicknessFrom: '1', thicknessTo: '50', validFrom: '2024-01-01', validTo: '2024-12-31', note: '' }])]))
  // SQL fixtures bypass the normal registry-save invalidation.
  await invalidateFixtureDispatcher()
})
test.afterEach(async ({ page }) => {
  await page.close()
  await withE2eDatabase(db => db.query('delete from welder_stamps where naks_stamp=any($1)', [[stamp, 'EXPA']]))
  await invalidateFixtureDispatcher()
})

async function invalidateFixtureDispatcher() {
  await withE2eDatabase(db => db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]',updated_at=now() where id=1"))
}

test('вкладки клейм: таблица, сохранение реестра, клавиатура и отсутствие повторных запросов', async ({ page }) => {
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/welder-stamps')
  const registry = page.getByRole('tab', { name: 'Клейма', exact: true })
  const checks = page.getByRole('tab', { name: 'Параметры проверки' })
  const cards = page.getByRole('tab', { name: 'Технологические карты' })
  await expect(registry).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Клейма')
  const notifications = page.getByText('Диспетчер оповещений клейм', { exact: true })
  await expect(notifications).toBeVisible()
  expect((await page.getByRole('tablist', { name: 'Разделы клейм' }).boundingBox())!.y)
    .toBeLessThan((await page.getByRole('heading', { level: 1 }).boundingBox())!.y)
  await page.getByRole('button', { name: /Фильтры и поиск/ }).click()
  await page.getByRole('textbox', { name: 'Поиск', exact: true }).fill(stamp)
  await page.getByRole('button', { name: /Нужно заполнить/ }).click()
  await page.getByText(stamp, { exact: true }).click()
  const heading = page.getByRole('heading', { name: 'Проверка вкладок' })
  await expect(heading).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(calls.filter(name => name.startsWith('loadWelderStampRegistrySnapshot'))).toHaveLength(1)
  calls.length = 0
  await checks.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Параметры проверки')
  await expect(notifications).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Как проверяется допуск клейма' })).toBeVisible()
  await expect(page.locator('[data-stamp-check-scenario]')).toHaveCount(12)
  await expect(page.getByRole('button', { name: 'Добавить клеймо' })).toBeHidden()
  await checks.press('Home')
  await expect(registry).toBeFocused()
  await expect(notifications).toBeVisible()
  await expect(heading).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Поиск', exact: true })).toHaveValue(stamp)
  await expect(page.getByRole('button', { name: /Нужно заполнить/ })).toHaveAttribute('aria-pressed', 'true')
  await registry.press('ArrowRight')
  await expect(cards).toBeFocused()
  await expect.poll(() => calls.filter(name => name.startsWith('getTechnologyCardPage')).length).toBe(1)
  await cards.press('ArrowRight')
  await expect(checks).toBeFocused()
  await checks.press('ArrowRight')
  await expect(registry).toBeFocused()
  await expect(heading).toBeVisible()
  await checks.click()
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')) })
  await page.waitForTimeout(700)
  expect(calls.filter(name => !name.startsWith('getTechnologyCardPage'))).toEqual([])
  expect(calls.filter(name => name.startsWith('getTechnologyCardPage'))).toHaveLength(1)
  await registry.click()
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Редактирование клейма' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: 'Добавить клеймо' }).click()
  await expect(page.getByRole('heading', { name: 'Добавление клейма' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(calls.filter(name => !name.startsWith('getTechnologyCardPage'))).toEqual([])
  expect(calls.filter(name => name.startsWith('getTechnologyCardPage'))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('параметры проверки: обычная прокрутка страницы, читаемые строки в узком окне и закрепление вкладок', async ({ page }) => {
  await page.goto('/welder-stamps')
  await page.getByRole('tab', { name: 'Параметры проверки' }).click()
  const region = page.getByRole('region', { name: 'Таблица параметров проверки клейм' })
  const last = region.locator('[data-stamp-check-scenario]').last()
  const columns = region.locator('thead')
  const tabs = page.getByRole('tablist', { name: 'Разделы клейм' })
  await expect(page.getByLabel('Цветовые обозначения примеров')).toContainText('не общий допуск команды')
  const examples = region.locator('[data-stamp-check-visual]')
  await expect(examples).toHaveCount(12)
  // Both alternatives belong to each worker; purple is not a pooled team permit.
  const cPair = examples.nth(1)
  await expect(cPair.locator('[data-check-fields][data-check-owner="both"]')).toHaveCount(4)
  await expect(cPair.getByText('ИЛИ', { exact: true })).toHaveCount(2)
  const uPair = examples.nth(5)
  await expect(uPair.locator('[data-check-fields="d2"]')).toHaveAttribute('data-check-owner', 'both')
  await expect(uPair.locator('[data-check-fields="t2"]')).toHaveAttribute('data-check-owner', 'both')
  await expect(uPair.locator('[data-check-fields="d1"]')).toHaveAttribute('data-check-owner', 'unused')
  await expect(uPair.locator('[data-check-fields="t1"]')).toHaveAttribute('data-check-owner', 'unused')
  for (const width of [1600, 1100, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    // The application's sidebar has a user-controlled collapsed state.
    if (width === 390) {
      await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', '64px')
      expect(await tabs.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    }
    await expect(region).toBeVisible()
    expect((await region.boundingBox())!.width).toBeLessThanOrEqual(width)
    expect(await region.evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true)
    expect(await region.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()
    await expect(last.getByRole('cell').last()).toBeInViewport()
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
    if (width >= 1280) {
      const header = (await columns.boundingBox())!
      const tabsBox = (await tabs.boundingBox())!
      expect(Math.abs(header.y - (tabsBox.y + tabsBox.height))).toBeLessThanOrEqual(1)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(tabs).toBeInViewport()
    if (width === 1600 || width === 390) {
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: `/private/tmp/welder-stamp-checks-page-${width}.png` })
      if (width === 1600) {
        await region.locator('[data-stamp-check-scenario]').nth(5).scrollIntoViewIfNeeded()
        await page.screenshot({ path: '/private/tmp/welder-stamp-checks-colours.png' })
      }
    }
  }
})

test('свой пример: стороны У, обе группы у двух сварщиков, распределение способов, ошибки и отсутствие записей', async ({ page }) => {
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto('/welder-stamps')
  await page.getByRole('tab', { name: 'Параметры проверки' }).click()
  await page.waitForLoadState('networkidle')
  calls.length = 0
  const details = page.locator('[data-stamp-check-example]')
  const summary = details.locator('summary')
  await expect(details).not.toHaveAttribute('open', '')
  await summary.click()
  for (const name of ['Стык', 'Стороны стыка', 'Сварщики']) await expect(details.getByRole('region', { name, exact: true })).toBeVisible()
  expect((await page.getByLabel('Тип соединения', { exact: true }).boundingBox())!.width).toBeLessThanOrEqual(260)
  const diameterBox = (await page.getByLabel('Диаметр D1, мм', { exact: true }).boundingBox())!
  const thicknessBox = (await page.getByLabel('Толщина T1, мм', { exact: true }).boundingBox())!
  expect(diameterBox.width).toBeLessThan(180)
  expect(Math.abs(diameterBox.y - thicknessBox.y)).toBeLessThan(1)
  const output = page.getByRole('region', { name: 'Результат разбора примера' })
  await expect(output.getByText('D1 = 108 или D2 = 108 мм')).toBeVisible()
  await page.getByLabel('Тип соединения', { exact: true }).selectOption('У19')
  await page.getByLabel('Диаметр D1, мм', { exact: true }).fill('57')
  await page.getByLabel('Толщина T1, мм', { exact: true }).fill('6')
  await page.getByLabel('Диаметр D2, мм', { exact: true }).fill('159')
  await page.getByLabel('Толщина T2, мм', { exact: true }).fill('3')
  await expect(output.getByText('D1 = 57 мм')).toBeVisible()
  await expect(output.getByText('T1 = 6 мм')).toBeVisible()
  await expect(output.getByText('T2 = 3 мм')).toHaveCount(0)
  await page.getByLabel('Группа 2', { exact: true }).selectOption('М05')
  await page.getByLabel('Количество клейм', { exact: true }).selectOption('2')
  await page.getByLabel('Способ сварки стыка', { exact: true }).selectOption('РАД+РД')
  for (const name of ['Сварщик А', 'Сварщик Б']) {
    const worker = output.getByRole('article', { name })
    await expect(worker.getByText('D1 = 57 мм')).toBeVisible()
    await expect(worker.getByText('T1 = 6 мм')).toBeVisible()
    await expect(worker.getByText('D2 = 159 мм')).toBeVisible()
    await expect(worker.getByText('T2 = 3 мм')).toBeVisible()
    await expect(worker.getByText('М01', { exact: true })).toBeVisible()
    await expect(worker.getByText('М05', { exact: true })).toBeVisible()
  }
  await page.getByLabel('Сварщик Б — способ', { exact: true }).selectOption('РАД')
  await expect(output.getByText(/не указан исполнитель способа РД/)).toBeVisible()
  await page.getByLabel('Сварщик Б — способ', { exact: true }).selectOption('РД')
  await expect(output.getByText(/не указан исполнитель/)).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: '/private/tmp/welder-stamp-example-desktop.png' })
  await summary.click()
  await expect(output).toBeHidden()
  await summary.click()
  await expect(page.getByLabel('Диаметр D1, мм', { exact: true })).toHaveValue('57')
  await page.getByRole('tab', { name: 'Клейма', exact: true }).click()
  await page.getByRole('tab', { name: 'Параметры проверки' }).click()
  await expect(page.getByLabel('Диаметр D1, мм', { exact: true })).toHaveValue('57')
  await page.getByLabel('Диаметр D1, мм', { exact: true }).fill('')
  await page.getByLabel('Толщина T2, мм', { exact: true }).fill('-3')
  await expect(output.getByText('D1: укажите положительное число в миллиметрах.')).toBeVisible()
  await expect(output.getByText('T2: укажите положительное число в миллиметрах.')).toBeVisible()
  await expect(output.getByRole('article')).toHaveCount(0)
  await page.getByLabel('Диаметр D1, мм', { exact: true }).fill('57')
  await page.getByLabel('Толщина T2, мм', { exact: true }).fill('3,5')
  await expect(output.getByText('T2 = 3.5 мм')).toHaveCount(2)
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
  await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', '64px')
  expect(await details.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.getByLabel('Диаметр D1, мм', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/private/tmp/welder-stamp-example-mobile.png' })
  expect(calls).toEqual([])
  expect(errors).toEqual([])
})

test('компактная компоновка: результат справа от ввода, размеры в строку без пустых высоких блоков', async ({ page }) => {
  await page.setViewportSize({ width: 2000, height: 1100 })
  await page.goto('/welder-stamps')
  await page.getByRole('tab', { name: 'Параметры проверки' }).click()
  const details = page.locator('[data-stamp-check-example]')
  await details.locator('summary').click()
  await page.getByLabel('Количество клейм', { exact: true }).selectOption('2')
  await page.getByLabel('Способ сварки стыка', { exact: true }).selectOption('РАД+РД')
  await page.getByLabel('Группа 2', { exact: true }).selectOption('М05')
  const output = page.getByRole('region', { name: 'Результат разбора примера' })
  const table = page.getByRole('region', { name: 'Таблица параметров проверки клейм' })
  for (const width of [2000, 1600]) {
    await page.setViewportSize({ width, height: 1100 })
    const inputBox = (await details.getByRole('region', { name: 'Стык', exact: true }).boundingBox())!
    const outputBox = (await output.boundingBox())!
    const detailsBox = (await details.boundingBox())!
    const row = table.locator('[data-stamp-check-scenario]').nth(10)
    const visual = row.locator('[data-stamp-check-visual]')
    const visualBox = (await visual.boundingBox())!
    const rowBox = (await row.boundingBox())!
    console.log(JSON.stringify({ width, exampleHeight: detailsBox.height, visualHeight: visualBox.height, rowHeight: rowBox.height }))
    expect.soft(outputBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width)
    expect.soft(Math.abs(outputBox.y - inputBox.y)).toBeLessThan(2)
    expect.soft(detailsBox.height).toBeLessThan(600)
    expect.soft(visualBox.height).toBeLessThan(210)
    expect.soft(rowBox.height).toBeLessThan(290)
    expect(await details.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `/private/tmp/welder-stamp-example-compact-${width}.png` })
    await details.locator('summary').click()
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/private/tmp/welder-stamp-table-compact-${width}.png` })
    await details.locator('summary').click()
  }
})

test('пояснения правил занимают свободную ширину ячейки и не увеличивают высоту строк', async ({ page }) => {
  await page.goto('/welder-stamps')
  await page.getByRole('tab', { name: 'Параметры проверки' }).click()
  const table = page.getByRole('region', { name: 'Таблица параметров проверки клейм' })
  const rows = table.locator('[data-stamp-check-scenario]')
  const originalText = await table.innerText()
  for (const width of [2200, 2000, 1600, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390) await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
    // Sidebar width and workspace padding animate across the responsive breakpoint.
    await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', width === 390 ? '64px' : width < 1024 ? '192px' : '256px')
    await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))) })
    for (const index of [2, 6, 10]) {
      const row = rows.nth(index)
      const layout = row.locator('[data-stamp-check-rules]')
      const conditions = (await row.locator('[data-stamp-check-conditions]').boundingBox())!
      const notes = (await row.locator('[data-stamp-check-notes]').boundingBox())!
      const available = (await layout.boundingBox())!.width
      const compactHeight = (await row.boundingBox())!.height
      if (available >= 576) {
        expect(notes.x).toBeGreaterThanOrEqual(conditions.x + conditions.width)
        expect(Math.abs(notes.y - conditions.y)).toBeLessThan(1)
        // Compare with the former stacked layout without changing data or hiding text.
        await layout.evaluate(node => { node.style.gridTemplateColumns = 'minmax(0, 1fr)' })
        const stackedHeight = (await row.boundingBox())!.height
        await layout.evaluate(node => { node.style.removeProperty('grid-template-columns') })
        expect(compactHeight).toBeLessThanOrEqual(stackedHeight)
        if (index === 6 && width === 2200) expect(compactHeight).toBeLessThan(stackedHeight)
        console.log(JSON.stringify({ width, row: index, compactHeight, stackedHeight }))
      } else {
        expect(Math.abs(notes.x - conditions.x)).toBeLessThan(1)
        expect(notes.y).toBeGreaterThanOrEqual(conditions.y + conditions.height)
      }
      expect(await layout.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    }
    // Breakpoints may add mobile column labels, but never drop any rule text.
    if (width >= 1280) expect(await table.innerText()).toBe(originalText)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (width === 2200 || width === 768) {
      await rows.nth(6).scrollIntoViewIfNeeded()
      await page.screenshot({ path: `/private/tmp/welder-stamp-rules-inline-${width}.png` })
    }
  }
})
