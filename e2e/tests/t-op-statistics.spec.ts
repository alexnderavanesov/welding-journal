import { expect, test, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { captureReportExcel } from '../report-excel-capture'

const PROJECT = 'E2E T-OP physical statistics'
test.afterEach(() => cleanupLineProgramProjects([PROJECT]))

async function seed() {
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,vik_result,weld_length,officiality,revision_actuality)
      values ($1,'SUPPORT','L1','ОП1','2026-09-01','Т1','да','ремонт',600,'действующий','актуальная'),
      ($1,'SUPPORT','L1','ОП1R1','2026-09-20','Т1','да','ремонт',600,'действующий','актуальная'),
      ($1,'SUPPORT','L1','ОП1R2','2026-10-03','Т1','да','годен',600,'действующий','актуальная'),
      ($1,'SUPPORT','L2','ОП2','2026-10-04','Т1','да',null,0.1,'действующий','актуальная'),
      ($1,'SUPPORT','L3','ОП3','2026-10-05','Т1','да','годен',null,'действующий','актуальная'),
      ($1,'SUPPORT','L4','ОП4','2026-10-06','Т1','да','ремонт',10,'действующий','актуальная'),
      ($1,'SUPPORT','L5','ОП5','2026-10-07','Т1','да','годен',0.2,'действующий','актуальная'),
      ($1,'SUPPORT','L6','F1','2026-10-07','С17','да','годен',null,'действующий','актуальная')`, [PROJECT])
  })
}
async function period(page: Page, from: string, to: string) {
  await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('custom')
  await page.getByLabel('Период с', { exact: true }).fill(from)
  await page.getByLabel('Период по', { exact: true }).fill(to)
  await expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled()
}

test('статистика опор: последнее продолжение, собственные даты ремонтов, негодность, пустая длина и скачанный Excel', async ({ page }, info) => {
  await seed()
  await page.goto('/statistics')
  await page.getByRole('button', { name: 'Опоры', exact: true }).click()
  await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
  await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(PROJECT.toLowerCase())
  await period(page, '2026-10-01', '2026-10-31')
  const panel = page.getByTestId('support-statistics')
  const card = (name: string) => panel.getByRole('button', { name: new RegExp(`^${name}`) }).first()
  await expect(card('Физические опоры')).toContainText('5 шт.')
  await expect(card('Основной объём')).toContainText('4 шт.')
  await expect(card('Текущие негодные')).toContainText('1 шт.')
  await expect(card('Ремонтные записи')).toContainText('1 шт.')
  await expect(panel.getByRole('heading', { name: 'Длина основного объёма', exact: true }).locator('..')).toContainText('0,60 (неполная) м')
  await expect(panel.getByText('Без длины: 1. Показатели в штуках сохранены; сумма длины неполна.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'WDI', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Основной объём · 2026-10: 4', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('supports-october-volume.png') })

  await period(page, '2026-09-01', '2026-09-30')
  await expect(card('Физические опоры')).toContainText('0 шт.')
  await expect(card('Основной объём')).toContainText('0 шт.')
  await expect(card('Ремонтные записи')).toContainText('1 шт.')
  await expect(panel.getByRole('heading', { name: 'Длина ремонтов', exact: true }).locator('..')).toContainText('0,60 м')

  await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
  await expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled()
  await expect(card('Физические опоры')).toContainText('5 шт.')
  await expect(card('Ремонтные записи')).toContainText('2 шт.')
  await expect(panel.getByRole('heading', { name: 'Длина ремонтов', exact: true }).locator('..')).toContainText(/1,20 м/)
  await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  await expect(preview.frameLocator('iframe').getByRole('heading', { name: 'Статистика опор', exact: true })).toBeVisible()
  const workbook = await captureReportExcel(page, preview, info.outputPath('support-physical-length.xlsx'))
  const rows = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '' }))
  const total = rows.find(row => row[0] === 'Итого')!
  expect(total, 'Downloaded workbook includes the complete summary').toBeTruthy()
  expect(total.slice(0, 7)).toEqual(['Итого', 5, 4, 1, '600,3 (неполная)', 1, 2])
  expect(Number(String(total[7]).replace(/\s/g, '').replace(',', '.'))).toBe(1200)
  expect(total[8]).toBe(0)
  expect(rows.some(row => row[0] === '2026-09' && row[1] === 0 && row[6] === 1)).toBe(true)
  expect(rows.some(row => row[0] === '2026-10' && row[1] === 5 && row[2] === 4 && row[3] === 1 && row[6] === 1)).toBe(true)
  expect(rows.flat().some(value => /\bWDI\b|ВДИ/.test(String(value)))).toBe(false)
  await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()

  // Existing production counts include only the ordinary joint in the same project.
  await page.getByRole('button', { name: 'Общая', exact: true }).click()
  await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
  await page.getByRole('button', { name: 'Стыки', exact: true }).click()
  const value = page.getByText('Сварено за период', { exact: true }).locator('..').locator(':scope > div').last()
  await expect(value).toHaveText('1')
})


test('опоры: весь период по умолчанию, точные длины с округлённым видом и простая таблица сварщиков', async ({ page }, info) => {
  await seed()
  await withLineProgramFixture(async db => {
    await db.query("update weld_joints set stamp_1_k_fact=case when joint='ОП1R2' then 'T-REPAIR' else 'T-MAIN' end where project_title=$1 and connection_type like 'Т%'", [PROJECT])
    await db.query("update weld_joints set weld_length='13652.873456789123456789' where project_title=$1 and joint like 'ОП1%'", [PROJECT])
    await db.query("update weld_joints set weld_length='400.1' where project_title=$1 and joint='ОП5'", [PROJECT])
  })
  await page.goto('/statistics')
  await expect(page.getByRole('button', { name: 'Опоры', exact: true })).toBeVisible()
  const tabs = await page.locator('[data-statistics-toolbar]').getByRole('button').allTextContents()
  expect(tabs.indexOf('Опоры')).toBe(tabs.indexOf('Сварщики') - 1)
  const nav = await page.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button').allTextContents()
  expect(nav.indexOf('Документы')).toBe(nav.indexOf('Статистика') - 1)
  await page.getByRole('button', { name: 'Опоры', exact: true }).click()
  await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Период отчета', exact: true })).toHaveValue('all')
  await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(PROJECT.toLowerCase())
  await expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled()
  const panel = page.getByTestId('support-statistics'), welders = page.getByTestId('support-welder-statistics')
  await expect(panel.getByRole('heading', { name: 'Длина основного объёма', exact: true }).locator('..')).toContainText('14,05 (неполная) м')
  await expect(panel.getByRole('heading', { name: 'Длина ремонтов', exact: true }).locator('..')).toContainText('27,31 м')
  await expect(panel.locator('[col-id="repairLength"]').filter({ hasText: /13\s653/ })).toHaveCount(2)
  const months = panel.getByRole('grid', { name: 'Статистика опор по месяцам', exact: true })
  await expect.poll(async () => (await months.boundingBox())!.height).toBeLessThan(200)
  await welders.scrollIntoViewIfNeeded()
  await expect(welders.getByRole('grid')).toBeVisible()
  await expect(welders.getByText('T-REPAIR', { exact: true })).toBeVisible()
  await expect(welders.locator('.ag-row[row-id="T-REPAIR"] [col-id="total"]')).toHaveText('1')
  await expect(welders.getByRole('button', { name: /Подробности сварщика/ })).toHaveCount(0)
  await expect(welders.getByText(/F:|S:/)).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('supports-welders.png') })
  await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  await expect(preview.frameLocator('iframe').getByRole('heading', { name: 'Сварщики — опоры', exact: true })).toBeVisible()
  const workbook = await captureReportExcel(page, preview, info.outputPath('support-welders.xlsx'))
  const rows = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '' }))
  expect(rows.find(row => row[0] === 'T-REPAIR')?.slice(2)).toEqual([1, 1, 0, 0, 0, 0])
  expect(rows.find(row => row[0] === 'T-MAIN')?.slice(2)).toEqual([6, 2, 1, 0, 3, 60])
  await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
  await page.getByRole('button', { name: 'Сварщики', exact: true }).click()
  await page.getByRole('button', { name: 'Опоры', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Период отчета', exact: true })).toHaveValue('all')
})

test('сварщики опор: общие фильтры столбцов, ФИО, округлённый процент, сочетания и отобранный Excel', async ({ page }, info) => {
  const stamps = ['T-FILTER-A', 'T-FILTER-B', 'T-FILTER-C']
  await seed()
  await withLineProgramFixture(async db => {
    await db.query("update weld_joints set stamp_1_k_fact=case when joint like 'ОП1%' then $2 else $3 end where project_title=$1 and connection_type like 'Т%'", [PROJECT, stamps[0], stamps[1]])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,vik_result,weld_length,officiality,revision_actuality,stamp_1_k_fact)
      values($1,'SUPPORT','L7','ОП7','2026-11-02','Т1','да','годен',500,'действующий','актуальная',$2)`, [PROJECT, stamps[2]])
    for (const [index, name] of ['Андреев Антон', 'Борисов Борис Борисович', 'Сидоров Сергей'].entries()) {
      await db.query('insert into welder_stamps(internal_stamp,welder_name) values($1,$2)', [stamps[index], name])
    }
  })
  try {
    const errors: string[] = [], calls: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && message.text().includes('AG Grid')) errors.push(message.text()) })
    page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Опоры', exact: true }).click()
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(PROJECT.toLowerCase())
    const welders = page.getByTestId('support-welder-statistics')
    await expect(welders.getByText('Показано сварщиков: 3 из 3', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled()
    const queryCount = () => calls.filter(name => name.startsWith('getStatisticsServerResult_')).length
    const initialQueries = queryCount()
    const openFilter = async (column: string, title: string) => {
      await welders.locator(`.ag-header-cell[col-id="${column}"] .ag-header-cell-filter-button`).click()
      const popup = page.getByRole('dialog', { name: `Фильтр: ${title}`, exact: true })
      await expect(popup.getByRole('textbox', { name: 'Найти значение фильтра', exact: true })).toBeFocused()
      await expect(page.locator('.read-only-grid-popup').getByRole('button', { name: 'Применить', exact: true })).toHaveCount(0)
      return popup
    }
    for (const [column, title, value, count] of [
      ['total', 'Всего', '4', 1], ['good', 'Годен', '2', 1], ['waitingRequest', 'Ожидает заявку', '1', 1],
      ['waitingControl', 'Ожидает НК', '0', 3], ['rejected', 'Не годен', '1', 1], ['defectPercent', '% брака', '33,3%', 1],
    ] as const) {
      const popup = await openFilter(column, title)
      await popup.getByRole('checkbox', { name: value, exact: true }).check()
      await expect(welders.getByText(`Показано сварщиков: ${count} из 3`, { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(popup).toHaveCount(0)
      await expect(welders.locator(`.ag-header-cell[col-id="${column}"]`)).toBeFocused()
      await welders.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click()
    }
    let popup = await openFilter('stamp', 'Клеймо')
    await popup.getByRole('textbox').fill('андреев')
    await popup.getByRole('checkbox', { name: 'T-FILTER-A — Андреев Антон', exact: true }).check()
    await popup.getByRole('textbox').fill('бОРИСОВ')
    await popup.getByRole('checkbox', { name: 'T-FILTER-B — Борисов Борис Борисович', exact: true }).check()
    await expect(welders.getByText('Показано сварщиков: 2 из 3', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    popup = await openFilter('defectPercent', '% брака')
    await expect(popup.getByRole('checkbox', { name: '0%', exact: true })).toHaveCount(0)
    await popup.getByRole('checkbox', { name: '33,3%', exact: true }).check()
    await expect(welders.getByText('Показано сварщиков: 1 из 3', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('support-welder-filter.png') })
    await popup.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
    await expect(welders.getByText('Показано сварщиков: 2 из 3', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    popup = await openFilter('stamp', 'Клеймо')
    await expect(popup.getByRole('textbox')).toHaveValue('бОРИСОВ')
    await popup.getByRole('textbox').fill('')
    await expect(popup.getByRole('checkbox', { name: 'T-FILTER-A — Андреев Антон', exact: true })).toBeChecked()
    await popup.getByRole('textbox').fill('Борисов')
    await popup.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
    await expect(welders.getByText('Показано сварщиков: 1 из 3', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(queryCount()).toBe(initialQueries)
    await expect(page.getByTestId('support-statistics').getByRole('button', { name: /^Физические опоры/ })).toContainText('6 шт.')
    await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
    await expect(preview.frameLocator('iframe').getByRole('cell', { name: 'T-FILTER-B', exact: true })).toBeVisible()
    await expect(preview.frameLocator('iframe').getByRole('cell', { name: 'T-FILTER-A', exact: true })).toHaveCount(0)
    const workbook = await captureReportExcel(page, preview, info.outputPath('support-filtered-welders.xlsx'))
    const rows = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '' }))
    expect(rows.filter(row => stamps.includes(String(row[0]))).map(row => row[0])).toEqual(['T-FILTER-B'])
    expect(rows.find(row => row[0] === 'T-FILTER-B')?.slice(2, 7)).toEqual([4, 2, 1, 0, 1])
    expect(rows.find(row => row[0] === 'Итого')?.[1]).toBe(6)
    await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    await period(page, '2026-09-01', '2026-09-30')
    await expect(welders.getByText('Показано сварщиков: 0 из 1', { exact: true })).toBeVisible()
    await welders.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click()
    await expect(welders.getByText('Показано сварщиков: 1 из 1', { exact: true })).toBeVisible()
    popup = await openFilter('stamp', 'Клеймо')
    await expect(popup.getByRole('checkbox', { name: /T-FILTER-B/ })).toHaveCount(0)
    await popup.getByRole('textbox').fill('нет такого клейма')
    await expect(popup.getByText('Значений не найдено', { exact: true })).toBeVisible()
    await expect(popup.getByRole('button', { name: 'Выбрать найденные', exact: true })).toBeDisabled()
    await popup.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
    expect(errors).toEqual([])
  } finally {
    await withLineProgramFixture(db => db.query('delete from welder_stamps where internal_stamp=any($1::text[])', [stamps]))
  }
})

// The line summary uses grid-column filters, without project/subtitle dropdowns.
for (const tab of ['Общая', 'ЛНК', 'ПСТО', 'Опоры', 'Сварщики']) test(`${tab}: проект и шифры остаются открытыми при прокрутке без новых запросов`, async ({ page }) => {
  await seed()
  await page.setViewportSize({ width: 1400, height: 740 })
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/statistics')
  await page.getByRole('main').getByRole('button', { name: tab, exact: true }).click()
  await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
  const project = page.getByRole('combobox', { name: 'Проект', exact: true })
  await project.selectOption(PROJECT.toLowerCase())
  await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
  await expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled()
  // Ensure enough page content to exercise genuine document scrolling even on an empty tab.
  await page.evaluate(() => { document.body.style.minHeight = '2000px'; window.scrollTo(0, 0) })
  await project.click()
  const options = page.locator('[data-select-listbox]')
  await expect(options).toBeVisible()
  const count = calls.filter(name => name.startsWith('getStatisticsServerResult_')).length
  const before = (await project.boundingBox())!
  await page.evaluate(() => window.scrollBy(0, 35))
  await expect.poll(async () => (await project.boundingBox())!.y).toBeLessThan(before.y)
  await expect(options).toBeVisible()
  await expect.poll(async () => Math.abs((await options.boundingBox())!.y - (await project.boundingBox())!.y - (await project.boundingBox())!.height - 4)).toBeLessThan(1)
  await project.press('Escape')
  const trigger = page.getByRole('button', { name: /^Шифр\/подтитул / })
  await trigger.click()
  const popup = page.getByRole('dialog', { name: 'Шифр/подтитул', exact: true })
  await popup.getByRole('searchbox').fill('SUP')
  await page.evaluate(() => window.scrollBy(0, 20))
  await expect(popup).toBeVisible()
  await expect(popup.getByRole('searchbox')).toHaveValue('SUP')
  await expect(popup.getByRole('checkbox', { name: 'SUPPORT', exact: true })).toBeVisible()
  expect(calls.filter(name => name.startsWith('getStatisticsServerResult_')).length).toBe(count)
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
