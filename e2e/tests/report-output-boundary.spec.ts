import { open } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { captureFullReportPrint } from '../report-print-capture'

// Deliberately opt-in: exercise the real supported output boundary, not an
// unreachable 200k-row call to the pure workbook builder. Use e2e/run.ts alone.
test('10000 строк: настоящий широкий предпросмотр и скачивание Excel', async ({ page }, info) => {
  test.skip(process.env.AUDIT_REPORT_BOUNDARY !== '1', 'Separate isolated browser/load run')
  test.setTimeout(240_000)
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int as n from weld_joints')).rows[0].n).toBe(1)
    await db.query(`insert into weld_joints(project_title,line,joint,weld_date,officiality,revision_actuality,
      connection_type,has_vik,vik_result,vik_conclusion_date,vik_conclusion)
      select 'E2E output boundary','BOUNDARY','MAX-EXPORT-F'||lpad(n::text,5,'0'),'2026-09-01',
        'действующий','актуальная','С17','да','годен','2026-09-02','VIK-BOUNDARY'
      from generate_series(1,10000) n`)
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('crash', () => errors.push('Browser page crashed'))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('MAX-EXPORT-')
  await expect(page.getByText('MAX-EXPORT-F00001', { exact: true })).toBeVisible()
  const started = Date.now()
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  const table = dialog.frameLocator('iframe').locator('table')
  await expect(table.locator('tbody tr')).toHaveCount(100, { timeout: 120_000 })
  await expect(table.locator('thead th')).toHaveCount(111)
  console.log(JSON.stringify({ workflow: '10000 x 111 browser preview', milliseconds: Date.now() - started }))
  await page.screenshot({ path: info.outputPath('paginated-report-preview.png') })
  await captureFullReportPrint(page)
  const printing = Date.now()
  await dialog.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').rows), { timeout: 120_000 }).toBe(10000)
  const printed = await page.evaluate(() => JSON.parse(document.body.dataset.fullPrint!))
  expect(printed.columns).toBe(111)
  expect(printed.lastRow).toContain('MAX-EXPORT-F10000')
  await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
  await expect(table.locator('tbody tr')).toHaveCount(100)
  console.log(JSON.stringify({ workflow: '10000 x 111 full print DOM', milliseconds: Date.now() - printing }))
  const downloading = Date.now()
  const downloaded = page.waitForEvent('download', { timeout: 90_000 })
  await dialog.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const download = await downloaded
  expect(await download.failure()).toBeNull()
  const path = await download.path()
  expect(path).toBeTruthy()
  const file = await open(path!, 'r')
  try {
    const { size } = await file.stat()
    const start = Buffer.alloc(4), end = Buffer.alloc(Math.min(size, 100_000))
    await file.read(start, 0, 4, 0)
    await file.read(end, 0, end.length, size - end.length)
    expect(start.toString('hex')).toBe('504b0304')
    expect(end.toString()).toContain('MAX-EXPORT-F10000')
    console.log(JSON.stringify({ workflow: '10000 x 111 browser download', milliseconds: Date.now() - downloading, bytes: size }))
  } finally { await file.close() }
  await dialog.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  await expect(dialog).toBeHidden()
  expect(errors).toEqual([])
})
