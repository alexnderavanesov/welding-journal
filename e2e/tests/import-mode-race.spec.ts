import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { rpcName } from '../rpc'

test('switching import mode retires a delayed line-validation response and allows a fresh upload', async ({ page }) => {
  let held = false, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/_serverFn/**', async route => {
    if (held || !rpcName(route.request().url()).startsWith('getLineProgramsForImport_')) return route.continue()
    const response = await route.fetch()
    held = true
    await gate
    await route.fulfill({ response })
  })
  try {
    await page.goto('/journal')
    await page.getByRole('button', { name: 'Импорт', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Импорт данных', exact: true })
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
    const templateFile = await download
    const template = XLSX.read(await readFile((await templateFile.path())!), { type: 'buffer' })
    const headers = XLSX.utils.sheet_to_json<unknown[]>(template.Sheets[template.SheetNames[0]], { header: 1 })[0].map(String)
    const upload = async (name: string, joint: string) => {
      const row: Record<string, string> = { Проект: 'E2E import mode race', Шифр: 'RACE', Линия: 'RACE', Стык: joint }
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, headers.map(key => row[key] ?? '')]), 'Импорт')
      await dialog.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) })
    }
    await upload('old.xlsx', 'OLD')
    await expect.poll(() => held).toBe(true)
    await dialog.getByRole('button', { name: 'Замена данных', exact: true }).click()
    const delivered = page.waitForResponse(response => rpcName(response.url()).startsWith('getLineProgramsForImport_'))
    release()
    await (await delivered).finished()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(dialog.getByText('Предпросмотр', { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /^Заменить/ })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Импорт данных', exact: true }).click()
    await upload('fresh.xlsx', 'FRESH')
    await expect(dialog.locator('[data-import-preview-grid] [col-id="joint"]').getByTitle('FRESH')).toBeVisible()
    await expect(dialog.getByText(/fresh.xlsx · найдено: 1/)).toBeVisible()
    await expect(dialog.getByText(/old.xlsx · найдено/)).toHaveCount(0)
  } finally { release() }
})
