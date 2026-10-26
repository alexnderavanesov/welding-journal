import { readFile } from 'node:fs/promises'
import { expect, type Locator, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { auditSqlCount } from './audit-sql'

/** Check the actual downloaded workbook against the visible snapshot, not a fixture export. */
export async function captureReportExcel(page: Page, modal: Locator, path?: string) {
  const metrics = await modal.frameLocator('iframe').locator('.metric').evaluateAll(cards => cards.map(card => ({
    label: card.querySelector('.metric-label')!.textContent!,
    value: card.querySelector('.metric-value')!.textContent!,
    detail: card.querySelector('.metric-detail')?.textContent ?? '',
  })))
  const freshDownload = await modal.getByText(/Excel содержит всю выборку/).count() > 0
  const pending = page.waitForEvent('download')
  const sqlBefore = await auditSqlCount()
  await modal.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const download = await pending
  expect(await download.failure()).toBeNull()
  const sqlAfter = await auditSqlCount()
  if (!freshDownload && sqlBefore !== undefined && sqlAfter !== undefined) expect(sqlAfter - sqlBefore).toBe(0)
  if (path) await download.saveAs(path)
  const workbook = XLSX.read(await readFile((await download.path())!), { type: 'buffer', cellStyles: true, cellNF: true })
  const summary = workbook.Sheets[workbook.SheetNames[0]]
  for (const [index, metric] of metrics.entries()) {
    const cell = Object.entries(summary).find(([key, cell]) => !key.startsWith('!') && cell.v === metric.label)
    expect(cell, metric.label).toBeTruthy()
    const address = XLSX.utils.decode_cell(cell![0])
    const value = summary[XLSX.utils.encode_cell({ r: address.r + 1, c: address.c })]
    const detail = summary[XLSX.utils.encode_cell({ r: address.r + 2, c: address.c })]
    const normalized = metric.value.replace(/\s/g, '').replace(',', '.').replace('%', '')
    const number = Number(normalized) / (metric.value.includes('%') ? 100 : 1)
    if (normalized && Number.isFinite(number)) expect(value).toMatchObject({ t: 'n', v: number })
    else expect(value.v).toBe(metric.value)
    expect(detail?.v ?? '').toBe(metric.detail)
    expect(value.s.patternType).toBe('solid')
    if (index > 0) expect(cell![0]).not.toBe('A1')
  }
  return workbook
}
