import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { VISIBLE_FIELDS } from '../../src/lib/weld-fields'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { isAccountRefreshRpc, rpcName } from '../rpc'

const PROJECT = 'E2E current journal columns'
const VIEW = 'Экспорт смены'
// WDI and weld date remain visible even in an older saved view that hid them.
const FIELD_KEYS = ['line', 'joint', 'responsible', 'projectTitle', 'subtitleCode', 'materialGroup', 'wdi', 'weldDate', 'finalStatus']
const HEADERS = ['Линия', 'Стык', 'Ответственный', 'Проект', 'Шифр', 'Группа материалов', 'WDI', 'Дата сварки', 'Итоговый статус']

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([PROJECT])
})

async function currentScreenFields(page: Page) {
  return page.locator('[data-welding-journal-grid] .ag-header-cell[col-id]').evaluateAll(headers => headers
    .filter(header => !header.getAttribute('col-id')!.startsWith('ag-') && !header.getAttribute('col-id')!.startsWith('__') && header.getAttribute('col-id') !== 'jointNextAction')
    .map(header => ({ key: header.getAttribute('col-id'), left: header.getBoundingClientRect().left }))
    .sort((a, b) => a.left - b.left).map(header => header.key))
}

async function interceptCurrentPrint(page: Page) {
  await page.evaluate(() => {
    document.addEventListener('load', event => {
      const frame = event.target
      if (!(frame instanceof HTMLIFrameElement) || frame.title !== 'Полный отчёт для печати') return
      frame.contentWindow!.print = () => {
        // Reassemble by original source index: print bands repeat the keys,
        // while every selected value must still match the preview/Excel snapshot.
        const headers: string[] = [], rows: string[][] = []
        for (const table of frame.contentDocument!.querySelectorAll<HTMLTableElement>('table[data-source-columns]')) {
          const sources = table.dataset.sourceColumns!.split(',').map(Number)
          table.querySelectorAll('thead th').forEach((cell, index) => { if (sources[index] >= 0) headers[sources[index]] = cell.textContent ?? '' })
          table.querySelectorAll('tbody tr').forEach((row, index) => {
            const values = [...row.querySelectorAll('td')].flatMap(cell => cell.colSpan > 1 ? Array<string>(cell.colSpan).fill('') : [cell.textContent ?? ''])
            rows[index] ??= []
            sources.forEach((source, column) => { if (source >= 0) rows[index][source] = values[column] })
          })
        }
        document.body.dataset.currentJournalPrint = JSON.stringify({ headers, rows })
        frame.contentWindow!.dispatchEvent(new Event('afterprint'))
      }
    }, true)
  })
}

async function verifyCurrentOutput(page: Page, calls: string[], headers = HEADERS) {
  const before = calls.length
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  const table = modal.frameLocator('iframe').locator('table')
  await expect(table.locator('thead th')).toHaveText(headers)
  await expect(table.locator('tbody tr')).toHaveCount(100)
  const readRows = () => table.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent ?? '')))
  const firstPage = await readRows()
  await modal.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(table.locator('tbody tr')).toHaveCount(25)
  const rows = [...firstPage, ...await readRows()]
  expect(rows.map(row => row[headers.indexOf('Стык')])).toEqual(Array.from({ length: 125 }, (_, index) => `F${String(125 - index).padStart(4, '0')}`))
  expect(rows.every(row => row.length === headers.length && row[headers.indexOf('Линия')] === 'CURRENT-EXPORT'
    && row[headers.indexOf('Проект')] === PROJECT && row[headers.indexOf('Шифр')] === 'CUR'
    && row[headers.indexOf('Группа материалов')] === 'М01')).toBe(true)
  const beforeLocalOutput = calls.length
  // The actual downloaded XLSX must contain all 125 filtered rows, not only
  // the 100 loaded grid rows, the 25-row preview page, or one collapsed group.
  const pending = page.waitForEvent('download')
  await modal.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const download = await pending
  expect(await download.failure()).toBeNull()
  const workbook = XLSX.read(await readFile((await download.path())!), { type: 'buffer' })
  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' })
  expect(sheet).toEqual([headers, ...rows])

  await page.evaluate(() => { delete document.body.dataset.currentJournalPrint })
  await modal.getByRole('button', { name: 'Печать / Сохранить PDF', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.currentJournalPrint ?? '{}').rows?.length)).toBe(125)
  expect(await page.evaluate(() => JSON.parse(document.body.dataset.currentJournalPrint!))).toEqual({ headers, rows })
  expect(calls.slice(beforeLocalOutput).filter(name => !name.startsWith('getDispatcherTaskVersion') && !isAccountRefreshRpc(name))).toEqual([])
  expect(calls.length - before).toBeLessThanOrEqual(5)
  await modal.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
  await expect(modal).toBeHidden()
}

test('журнал: текущая версия сохраняет видимые поля и экранный порядок в предпросмотре, Excel и печатном DOM', async ({ page }) => {
  test.setTimeout(120_000)
  await withE2eDatabase(db => db.query(`insert into weld_joints
    (project_title,subtitle_code,line,joint,connection_type,material_group,welding_method,d1,t1,element_1,responsible)
    select $1,'CUR','CURRENT-EXPORT','F'||lpad(n::text,4,'0'),'С17','М01','РД',159,8,'Труба','Ответственный '||n
    from generate_series(1,125) n`, [PROJECT]))
  // Start from a compact pre-existing personal view. The actions under test
  // (hiding a field/section, moving columns, saving and applying) use real UI.
  const initial = new Set([...FIELD_KEYS.filter(key => key !== 'wdi' && key !== 'weldDate'), 'd1', 'element1'])
  await page.addInitScript(hiddenFieldKeys => {
    if (localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('welding-user:') && key.endsWith(':welding-report-view:v1:weldingJournal')) ?? 'welding-report-view:v1:weldingJournal')) return
    localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
      activePreset: 'custom', hiddenFieldKeys, customHiddenFieldKeys: hiddenFieldKeys,
      collapsedSections: ['Следующий шаг'], savedViews: [],
    }))
  }, VISIBLE_FIELDS.filter(field => !initial.has(field.key)).map(field => field.key))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1920, height: 1000 })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
  await expect(page.getByText('Найдено: 125', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const grid = page.locator('[data-welding-journal-grid]')
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида журнала', exact: true })
  await settings.getByRole('textbox', { name: 'Найти столбец или раздел' }).fill('D1')
  await settings.getByRole('checkbox', { name: 'D1', exact: true }).uncheck()
  await settings.getByRole('textbox', { name: 'Найти столбец или раздел' }).fill('')
  await settings.getByRole('checkbox', { name: 'Раздел: Материалы', exact: true }).uncheck()
  await page.keyboard.press('Escape')
  await expect(grid.locator('.ag-header-cell[col-id="d1"]')).toHaveCount(0)
  await expect(grid.locator('.ag-header-cell[col-id="element1"]')).toHaveCount(0)

  await grid.locator('.ag-header-cell[col-id="responsible"]').hover()
  await grid.locator('.ag-header-cell[col-id="projectTitle"]').hover()
  const source = (await grid.locator('.ag-header-cell[col-id="responsible"]').boundingBox())!
  const target = (await grid.locator('.ag-header-cell[col-id="projectTitle"]').boundingBox())!
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 20 })
  await page.mouse.up()
  await expect.poll(() => currentScreenFields(page)).toEqual(FIELD_KEYS)

  await grid.locator('.ag-header-cell[col-id="joint"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
  await expect(grid.getByRole('button', { name: 'F0125', exact: true })).toBeVisible()
  await grid.locator('.ag-header-cell[col-id="materialGroup"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать/ }).click()
  await expect(grid.locator('.ag-row-group')).toHaveCount(1)
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  await settings.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await settings.getByRole('textbox', { name: 'Название вида', exact: true }).fill(VIEW)
  await settings.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForLoadState('networkidle')
  await interceptCurrentPrint(page)
  await verifyCurrentOutput(page, calls)

  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  await settings.getByRole('tab', { name: 'Оформление', exact: true }).click()
  await settings.getByRole('button', { name: 'Сбросить столбцы', exact: true }).click()
  await settings.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await settings.getByRole('button', { name: new RegExp(`^${VIEW}`) }).click()
  await expect.poll(() => currentScreenFields(page)).toEqual(FIELD_KEYS)
  await page.reload()
  await expect.poll(() => currentScreenFields(page)).toEqual(FIELD_KEYS)
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  await settings.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await settings.getByRole('button', { name: new RegExp(`^${VIEW}`) }).click()
  await expect(page.getByText('Найдено: 125', { exact: true })).toBeVisible()
  await expect(grid.locator('.ag-row-group')).toHaveCount(1)
  await page.waitForLoadState('networkidle')
  // Reload discards the print interceptor, so reinstall it before the repeated output.
  await interceptCurrentPrint(page)
  await verifyCurrentOutput(page, calls)

  // A failed save must not turn current output into the old persisted view.
  const persisted = await page.evaluate(() => ({
    view: localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('welding-user:') && key.endsWith(':welding-report-view:v1:weldingJournal')) ?? 'welding-report-view:v1:weldingJournal'),
    grid: localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('welding-user:') && key.endsWith(':welding-journal-ag-grid:v1')) ?? 'welding-journal-ag-grid:v1'),
  }))
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (['welding-report-view:v1:weldingJournal', 'welding-journal-ag-grid:v1'].some(name => key === name || key.startsWith('welding-user:') && key.endsWith(':' + name))) {
        throw new DOMException('Test storage quota exceeded', 'QuotaExceededError')
      }
      return setItem.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  await settings.getByRole('tab', { name: 'Столбцы', exact: true }).click()
  await settings.getByRole('textbox', { name: 'Найти столбец или раздел' }).fill('Ответственный')
  await settings.getByRole('checkbox', { name: 'Ответственный', exact: true }).uncheck()
  await page.keyboard.press('Escape')
  await expect(grid.locator('.ag-header-cell[col-id="responsible"]')).toHaveCount(0)
  // Hiding the previous column animates both headers left. Locator hover waits
  // for stable geometry; reading boundingBox alone can capture the old positions.
  await grid.locator('.ag-header-cell[col-id="subtitleCode"]').hover()
  await grid.locator('.ag-header-cell[col-id="projectTitle"]').hover()
  const subtitle = (await grid.locator('.ag-header-cell[col-id="subtitleCode"]').boundingBox())!
  const project = (await grid.locator('.ag-header-cell[col-id="projectTitle"]').boundingBox())!
  await page.mouse.move(subtitle.x + subtitle.width / 2, subtitle.y + subtitle.height / 2)
  await page.mouse.down()
  await page.mouse.move(project.x + 8, project.y + project.height / 2, { steps: 20 })
  await page.mouse.up()
  await expect.poll(() => currentScreenFields(page)).toEqual(['line', 'joint', 'subtitleCode', 'projectTitle', 'materialGroup', 'wdi', 'weldDate', 'finalStatus'])
  expect(await page.evaluate(() => ({
    view: localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('welding-user:') && key.endsWith(':welding-report-view:v1:weldingJournal')) ?? 'welding-report-view:v1:weldingJournal'),
    grid: localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('welding-user:') && key.endsWith(':welding-journal-ag-grid:v1')) ?? 'welding-journal-ag-grid:v1'),
  }))).toEqual(persisted)
  await verifyCurrentOutput(page, calls, ['Линия', 'Стык', 'Шифр', 'Проект', 'Группа материалов', 'WDI', 'Дата сварки', 'Итоговый статус'])
  expect(errors).toEqual([])
})
