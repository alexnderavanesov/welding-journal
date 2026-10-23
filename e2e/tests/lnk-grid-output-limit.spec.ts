import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { captureFullReportPrint } from '../report-print-capture'
import { WELD_FIELDS } from '../../src/lib/weld-fields'

const project = 'E2E LNK current print boundary'
test.beforeEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(db => db.query(`insert into weld_joints(project_title,line,joint,weld_date,
    officiality,revision_actuality,has_vik,vik_result)
    select $1,case when n<=1000 then 'LNK-PRINT-ALLOWED' else 'LNK-PRINT-EXTRA' end,
      'F'||(900000+n),'2026-09-01','действующий','актуальная','да','годен'
    from generate_series(1,1001) n`, [project]))
})
test.afterEach(() => cleanupLineProgramProjects([project]))

test('ЛНК: текущий вид печатает 1000, отказывает при 1001 и сохраняет весь Excel', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(hidden => {
    localStorage.setItem('welding-report-view:v1:lnk', JSON.stringify({ activePreset: 'custom',
      hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [] }))
  }, WELD_FIELDS.filter(field => !['line','joint','vikResult'].includes(field.key)).map(field => field.key))
  await page.goto('/lnk')
  await captureFullReportPrint(page)
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  const showCurrent = async () => {
    await expect(page.locator('[data-lnk-grid] .journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
    await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
    await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
    await expect(preview.frameLocator('iframe').locator('tbody tr')).toHaveCount(100)
  }
  await search.fill(project)
  await expect(page.getByText('Найдено: 1001', { exact: true })).toBeVisible()
  await showCurrent()
  await expect(preview.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeDisabled()
  await expect(preview.getByRole('status')).toContainText('В отчёте 1001 строк')
  await page.keyboard.press('Control+p')
  await preview.frameLocator('iframe').locator('tbody').press('Meta+p')
  expect(await page.evaluate(() => document.body.dataset.fullPrint)).toBeUndefined()
  await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
  const downloading = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const download = await downloading
  expect(await download.failure()).toBeNull()
  const workbook = XLSX.read(await readFile((await download.path())!), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' })
  expect(rows).toHaveLength(1002)
  // Mandatory columns are restored even when an older personal view hid them.
  expect(rows[0]).toEqual(['Линия','Стык','WDI','Дата сварки','Результат ВИК','Итоговый статус'])
  expect(new Set(rows.slice(1).map(row => row[1])).size).toBe(1001)
  expect(rows.some(row => row[1] === 'F901001')).toBe(true)
  await page.keyboard.press('Escape')
  await search.fill('LNK-PRINT-ALLOWED')
  await expect(page.getByText('Найдено: 1000', { exact: true })).toBeVisible()
  await showCurrent()
  await expect(preview.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeEnabled()
  await preview.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').rows)).toBe(1000)
  const printed = await page.evaluate(() => JSON.parse(document.body.dataset.fullPrint!))
  expect(printed).toMatchObject({ rows: 1000, columns: 6, minColumns: 6, maxColumns: 6 })
  expect(printed.lastRow).toContain('F901000')
  await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
  expect(errors).toEqual([])
})
