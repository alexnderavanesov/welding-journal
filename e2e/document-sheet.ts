import { expect, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'

export async function previewSheetText(modal: Locator) {
  const body = modal.frameLocator('iframe').locator('body')
  await expect(body.locator('table')).toBeVisible()
  return (await body.innerText()).replace(/\s+/g, ' ').trim()
}

export async function downloadPreviewExcel(page: Page, modal: Locator) {
  const button = modal.getByRole('button', { name: 'Скачать Excel', exact: true })
  await expect(button).toBeEnabled()
  const pending = page.waitForEvent('download')
  await button.click()
  const download = await pending
  expect(await download.failure()).toBeNull()
  expect(download.suggestedFilename()).toMatch(/\.xlsx?$/i)
  const bytes = await readFile((await download.path())!)
  const workbook = XLSX.read(bytes, { type: 'buffer' })
  const text = workbook.SheetNames.map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\n').replace(/\s+/g, ' ').trim()
  return { bytes, workbook, text }
}
