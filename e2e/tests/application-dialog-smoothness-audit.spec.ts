import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { readFile } from 'node:fs/promises'
import { createSmoothnessProbe } from '../smoothness-probe'
import { seedSmoothnessFixture, cleanupSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'

const enabled = !!process.env.SMOOTHNESS_LABEL
test.skip(!enabled, 'Explicit local performance comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 10000 })
test.beforeAll(async () => { if (enabled) { test.setTimeout(180000); await seedSmoothnessFixture() } })
test.afterAll(async () => { if (enabled) { test.setTimeout(180000); await cleanupSmoothnessFixture() } })

test('program: overview tabs, stamp detail, nested joints, assignments and PSTO exceptions', async ({ page }, info) => {
  test.setTimeout(600000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/line-program')
    const lines = page.locator('[data-program-grid="lines"]')
    await expect(lines.locator('.ag-row').first()).toBeVisible()
    for (const tab of ['100%-ные линии', 'Процентные линии', 'Опоры', 'Все линии']) {
      await probe.measure(`program:tab:${tab}`, async () => { await page.getByRole('button', { name: tab, exact: true }).click(); await expect(lines.locator('.ag-row').first()).toBeVisible() })
    }
    await probe.scroll('program:lines-scroll', lines)
    await probe.resize('program:lines-resize', lines)
    await page.getByLabel('Поиск программы линий', { exact: true }).fill('SM-0001')
    await probe.measure('program:stamp-detail', async () => {
      await page.getByRole('button', { name: 'Расчёт линии SM-0001', exact: true }).click()
      await expect(page.locator('[data-program-grid="stamps"] .ag-row').first()).toBeVisible()
    })
    const stamps = page.locator('[data-program-grid="stamps"]')
    await probe.scroll('program:stamps-scroll', stamps)
    await probe.resize('program:stamps-resize', stamps)
    await probe.measure('program:nested-joints', async () => {
      await page.getByRole('button', { name: 'Клеймо Q000', exact: true }).click()
      await expect(page.locator('[data-program-grid="joints"] .ag-row').first()).toBeVisible()
    })
    await probe.resize('program:nested-resize', page.locator('[data-program-grid="joints"]'))
    for (let n = 0; n < 3; n++) {
      await probe.measure(`program:assignment-open:${n}`, async () => {
        await page.getByRole('button', { name: 'Открыть назначения линии SM-0001', exact: true }).click()
        await expect(page.locator('[data-program-grid="assignments"] .ag-row').first()).toBeVisible()
      })
      const grid = page.locator('[data-program-grid="assignments"]')
      if (n === 0) { await probe.scroll('program:assignment-scroll', grid); await probe.resize('program:assignment-resize', grid) }
      await page.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
    }
    await page.goto('/psto')
    await probe.measure('psto:program-open', async () => {
      await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
      await expect(page.getByRole('grid', { name: 'Линии программы ПСТО', exact: true }).locator('.ag-row').first()).toBeVisible()
    })
    await probe.scroll('psto:program-scroll', page.getByRole('grid', { name: 'Линии программы ПСТО', exact: true }))
    await probe.resize('psto:program-resize', page.getByRole('grid', { name: 'Линии программы ПСТО', exact: true }))
    await probe.measure('psto:exceptions-open', async () => { await page.getByRole('button', { name: 'Исключения', exact: true }).click(); await expect(page.getByRole('grid', { name: 'Исключения ПСТО', exact: true })).toBeVisible() })
    await probe.measure('psto:exception-candidates', async () => { await page.getByRole('button', { name: 'Добавить исключение', exact: true }).click(); await expect(page.getByRole('grid', { name: 'Выбор цепочки для исключения ПСТО', exact: true }).locator('.ag-row').first()).toBeVisible() })
    await probe.scroll('psto:exception-candidates-scroll', page.getByRole('grid', { name: 'Выбор цепочки для исключения ПСТО', exact: true }))
  } finally { await probe.finish() }
})

test('references: large registry, permit editor, suspensions, specialists and technology cards', async ({ page }, info) => {
  test.setTimeout(600000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/references')
    await expect(page.getByRole('row').filter({ hasText: 'Q000' }).first()).toBeVisible()
    const table = page.getByRole('region', { name: 'Таблица клейм — горизонтальная прокрутка', exact: true })
    await probe.scroll('references:stamps-scroll', table)
    for (let n = 0; n < 5; n++) {
      const row = table.getByRole('row').filter({ hasText: 'Q000' }).first()
      await probe.measure(`references:card-open:${n}`, async () => { await row.click(); await expect(page.getByRole('heading', { name: 'Сварщик плавности 0001', exact: true })).toBeVisible() })
      if (n === 0) {
        await probe.measure('references:permit-editor', async () => { await page.getByRole('button', { name: 'Редактировать этот допуск', exact: true }).first().click(); await expect(page.getByRole('dialog')).toBeVisible() })
        await probe.scroll('references:permit-editor-scroll', page.getByRole('dialog'))
        await page.keyboard.press('Escape')
      }
      await probe.measure(`references:card-close:${n}`, async () => { await row.click(); await expect(page.getByRole('heading', { name: 'Сварщик плавности 0001', exact: true })).toBeHidden() })
    }
    await page.getByRole('button', { name: /История отстранений/ }).click()
    await probe.measure('references:suspension-editor', async () => { await page.getByRole('button', { name: 'Добавить запись', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Добавление отстранения', exact: true })).toBeVisible() })
    await page.keyboard.press('Escape')
    await page.goto('/references?tab=specialists')
    await expect(page.getByRole('row').filter({ hasText: 'SM специалист' }).first()).toBeVisible()
    await probe.scroll('references:specialists-scroll', page.getByRole('main'))
    await probe.measure('references:specialist-search', async () => { await page.getByRole('searchbox', { name: 'Поиск специалистов в справочнике', exact: true }).fill('SM специалист 0500'); await expect(page.getByRole('row').filter({ hasText: 'SM специалист' })).toHaveCount(1) })
    await probe.measure('references:specialist-editor', async () => { await page.getByRole('button', { name: 'Добавить специалиста', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Добавление специалиста', exact: true })).toBeVisible() })
    await page.keyboard.press('Escape')
    await page.goto('/references?tab=technologyCards')
    await expect(page.getByRole('row').filter({ hasText: 'SM-TK-' }).first()).toBeVisible()
    await probe.scroll('references:techcards-scroll', page.getByRole('region', { name: 'Реестр технологических карт', exact: true }))
    await probe.measure('references:techcards-search', async () => { await page.getByRole('searchbox', { name: 'Поиск технологических карт', exact: true }).fill('SM-TK-0500'); await expect(page.getByRole('row').filter({ hasText: 'SM-TK-0500' })).toHaveCount(1) })
    await probe.measure('references:techcard-assignment', async () => { await page.getByRole('button', { name: 'Проверить и назначить ТК', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Проверить и назначить ТК', exact: true })).toBeVisible(); await expect(page.getByRole('dialog').getByText(/Подготовка|Проверяем/)).toHaveCount(0) })
    const assignment = page.getByRole('dialog')
    await probe.measure('references:techcard-scan-5000', async () => {
      await assignment.getByRole('button', { name: 'Начать проверку', exact: true }).click()
      await expect(assignment.getByRole('button', { name: 'Проверить заново', exact: true })).toBeEnabled({ timeout: 120000 })
      await assignment.getByRole('combobox', { name: 'Показать стыки', exact: true }).selectOption('all')
      await expect(assignment.getByRole('row').nth(1)).toBeVisible()
    })
    await probe.scroll('references:techcard-assignment-scroll', page.getByRole('dialog'))
    await probe.measure('references:techcard-next-page', async () => {
      await assignment.getByRole('button', { name: 'Далее', exact: true }).click()
      await expect(assignment.getByText(/страница 2 из/)).toBeVisible()
    })
    await page.getByRole('button', { name: 'Закрыть проверку ТК', exact: true }).click()
  } finally { await probe.finish() }
})

test('documents and import: registries, grouping, report preview and full import preview', async ({ page }, info) => {
  test.setTimeout(600000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/documents')
    for (const label of ['ЖСР', 'Чек-лист', 'ЗНИ', 'Послойный ВИК', 'Послойный ПВК', 'Заявка ЛНК', 'Заключения ЛНК', 'Заявка ПСТО', 'Заключение ПСТО', 'Заявка ТВМТ', 'Заключение ТВМТ']) {
      await probe.measure(`documents:tab:${label}`, async () => { await page.getByRole('button', { name: label, exact: true }).click(); await expect(page.locator('[data-document-history-grid]')).toBeVisible(); await page.waitForLoadState('networkidle') })
      const grid = page.locator('[data-document-history-grid]')
      if (await grid.locator('.ag-row').count()) { await probe.scroll(`documents:${label}:scroll`, grid); await probe.resize(`documents:${label}:resize`, grid) }
    }
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
    await expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled()
    await probe.measure('statistics:report-preview', async () => { await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })).toBeVisible() })
    await probe.scroll('statistics:preview-scroll', page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true }).frameLocator('iframe').locator('body'))
    await page.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    await page.goto('/journal')
    await page.getByRole('button', { name: 'Импорт', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Импорт данных', exact: true }) })
    const download = page.waitForEvent('download', { timeout: 10000 })
    await probe.measure('import:template-download', async () => {
      await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
      await download
    })
    const template = XLSX.read(await readFile((await (await download).path())!), { type: 'buffer' })
    const headers = (XLSX.utils.sheet_to_json<unknown[]>(template.Sheets[template.SheetNames[0]], { header: 1 })[0]).map(String)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...Array.from({ length: 500 }, (_, n) => {
      const values: Record<string, string> = { Проект: SMOOTHNESS_PROJECT, Шифр: 'PREVIEW', Линия: `IMP-${n}`, Стык: 'F1', 'Дата сварки': '01.10.2026' }
      return headers.map(header => values[header] ?? '')
    })]), 'Импорт')
    const file = { name: 'smoothness-preview.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) }
    await probe.measure('import:parse-500', async () => { await dialog.locator('input[type=file]').setInputFiles(file); await expect(dialog.getByText(/найдено: 500/)).toBeVisible({ timeout: 60000 }) })
    await probe.measure('import:show-all-500', async () => { await dialog.getByRole('button', { name: 'Все', exact: true }).click(); await expect(dialog.getByText('Строки: 500/500')).toBeVisible() })
    const grid = dialog.locator('[data-import-preview-grid]')
    await probe.scroll('import:vertical', grid); await probe.scroll('import:horizontal', grid, true); await probe.resize('import:resize', grid)
    expect(await grid.locator('.ag-row').count()).toBeLessThan(100)
  } finally { await probe.finish() }
})

test('settings, rules, guide, access and activity: tabs and nested editors', async ({ page }, info) => {
  test.setTimeout(600000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/settings')
    for (const label of ['Документы', 'Заявки и заключения', 'Данные', 'Системные индексы', 'Правила и проверки', 'Расчет дюймов', 'Процессы контроля']) {
      await probe.measure(`settings:tab:${label}`, async () => { await page.getByRole('main').getByRole('button', { name: label, exact: true }).click() })
      await probe.scroll(`settings:${label}:scroll`, page.getByRole('main'))
      if (['Расчет дюймов', 'Процессы контроля'].includes(label)) {
        await probe.measure(`settings:${label}:matrix-open`, async () => { await page.getByRole('button', { name: /^(Редактировать|Заполнить) справочник$/ }).click(); await expect(page.getByRole('dialog')).toBeVisible() })
        await probe.scroll(`settings:${label}:matrix-scroll`, page.getByRole('dialog'))
        await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click()
      }
    }
    await page.goto('/account?tab=rules&section=connections')
    const rules = page.getByRole('treegrid')
    await expect(rules.locator('.ag-row').first()).toBeVisible()
    await probe.scroll('rules:scroll', rules); await probe.resize('rules:resize', rules)
    await page.goto('/account?tab=guide')
    await expect(page.locator('.user-guide-page')).toBeVisible()
    await probe.scroll('guide:scroll', page.getByRole('main'))
    await page.goto('/account?tab=users')
    await probe.measure('access:permissions-open', async () => { await page.getByRole('button', { name: 'Посмотреть права', exact: true }).first().click(); await expect(page.getByRole('dialog')).toBeVisible() })
    await probe.scroll('access:permissions-scroll', page.getByRole('dialog'))
    await page.keyboard.press('Escape')
    await page.goto('/activity')
    const grid = page.getByRole('grid', { name: 'Журнал действий', exact: true })
    await expect(grid.locator('.ag-row').first()).toBeVisible()
    await probe.scroll('activity:scroll', grid); await probe.resize('activity:resize', grid)
    await probe.measure('activity:details-open', async () => { await grid.getByRole('button', { name: 'Подробности', exact: true }).first().click(); await expect(page.getByRole('dialog')).toBeVisible() })
    await probe.scroll('activity:details-scroll', page.getByRole('dialog'))
  } finally { await probe.finish() }
})
