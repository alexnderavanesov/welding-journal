import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { captureReportExcel } from '../report-excel-capture'

test('general statistics: one physical connection, repair month, rejection and complete report agree', async ({ page }, info) => {
  const project = 'E2E general physical production'
  try {
    await withLineProgramFixture(async db => {
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,vik_result,wdi,stamp_1_k_fact)
        values ($1,'GENERAL','L1','S1','2026-09-01','С17','да','ремонт',2140.05,'W1'),
        ($1,'GENERAL','L1','S1R1','2026-10-02','С17','да','годен',2140.05,'W2'),
        ($1,'GENERAL','L2','S2','2026-10-03','С17','да','годен',3796.7,'W3'),
        ($1,'GENERAL','L3','S3','2026-10-04','С17','да','ремонт',8.05,'W4')`, [project])
    })
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(project.toLowerCase())
    await page.getByRole('button', { name: 'WDI', exact: true }).click()
    await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('custom')
    await page.getByLabel('Период с', { exact: true }).fill('2026-10-01')
    await page.getByLabel('Период по', { exact: true }).fill('2026-10-31')
    const value = page.getByText('Сварено за период', { exact: true }).locator('..').locator(':scope > div').last()
    await expect(value).toHaveText('5 936,75')
    await expect(page.getByText('Негодных стыков: 1 · 8,05 WDI', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('general-october-net-volume.png') })
    await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
    await expect(preview.frameLocator('iframe').locator('.metric').first()).toContainText('5 936,75')
    const workbook = await captureReportExcel(page, preview, info.outputPath('general-physical.xlsx'))
    const cells = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1 })).flat()
    expect(cells.some(value => Number(String(value).replace(/\s/g, '').replace(',', '.')) === 5936.75)).toBe(true)
    expect(cells.some(value => String(value).includes('Негодных стыков: 1'))).toBe(true)
    await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    await page.getByRole('button', { name: 'Стыки', exact: true }).click()
    await expect(value).toHaveText('2')
    await page.getByLabel('Период с', { exact: true }).fill('2026-09-01')
    await page.getByLabel('Период по', { exact: true }).fill('2026-09-30')
    await expect(value).toHaveText('0')
    await page.screenshot({ path: info.outputPath('general-after-repair-month.png') })
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
  }
})
