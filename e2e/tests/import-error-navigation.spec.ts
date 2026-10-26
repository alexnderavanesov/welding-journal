import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'

test('import error jump reveals and focuses the cell from below a long error list', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('button', { name: 'Импорт', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Импорт данных', exact: true })
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
  const file = await download
  const template = XLSX.read(await readFile((await file.path())!), { type: 'buffer' })
  const headers = XLSX.utils.sheet_to_json<unknown[]>(template.Sheets[template.SheetNames[0]], { header: 1 })[0].map(String)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers,
    ...Array.from({ length: 120 }, (_, i) => {
      const row: Record<string, string> = { Проект: 'E2E navigation only', Шифр: 'ERR', Линия: 'L', Стык: `F${i + 1}`, 'Дата сварки': '31.02.2026' }
      return headers.map(header => row[header] ?? '')
    }),
  ]), 'Импорт')
  await dialog.locator('input[type=file]').setInputFiles({ name: 'errors.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) })
  const error = dialog.getByRole('button', { name: /Строка 121:/ }).filter({ hasText: 'Дата сварки' }).first()
  await error.scrollIntoViewIfNeeded()
  await error.click()
  const cell = dialog.locator('[data-import-preview-grid] [row-id="119"] [col-id="weldDate"]')
  await expect(cell).toBeFocused()
  await expect(cell).toBeInViewport()
  // Also reject coverage by the dialog header/footer or another scroll layer.
  await expect.poll(() => cell.evaluate(element => {
    const box = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  })).toBe(true)
})
