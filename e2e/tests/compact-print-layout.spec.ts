import { expect, test } from '@playwright/test'
import { buildPrintableReportHtml, type PrintableReport } from '../../src/lib/printable-report'

test('экономная печать сохраняет геометрию, значения и оформление широкого отчёта', async ({ page }, info) => {
  await page.emulateMedia({ media: 'print' })
  const report: PrintableReport = { title: 'Проверка печати', tables: [{ title: 'Данные',
    columns: Array.from({ length: 12 }, (_, i) => `Поле ${i + 1}`),
    rows: [
      ['Стык S1', '', '', '', '', 'Длинный текст для проверки переноса', '', '', '', '', '', '57×6'],
      ['', '', '', 'S2', 0, '', '', '', '', '', '', 'Конец'],
      ['Группа', '', '', '', '', '', '', '', '', '', '', ''],
      ['Итого', '', '', '', '', '', '', '', '', '', '', '2'],
    ], rowKinds: ['detail', 'detail', 'group', 'total'],
  }] }
  const readLayout = () => page.evaluate(() => ({
    headers: [...document.querySelectorAll('th')].map(cell => ({ left: cell.getBoundingClientRect().left, width: cell.getBoundingClientRect().width })),
    rows: [...document.querySelectorAll('tbody tr')].map(row => ({ height: row.getBoundingClientRect().height,
      values: [...row.querySelectorAll('td')].flatMap(cell => cell.colSpan > 1 ? Array(cell.colSpan).fill('') : [cell.textContent]),
      populated: [...row.querySelectorAll('td')].filter(cell => cell.textContent).map(cell => ({
        left: cell.getBoundingClientRect().left, width: cell.getBoundingClientRect().width,
        color: getComputedStyle(cell).color, background: getComputedStyle(cell).backgroundColor,
      })),
    })),
  }))
  await page.setContent(buildPrintableReportHtml(report, { embedded: true }))
  const before = await readLayout()
  await page.screenshot({ path: info.outputPath('print-original.png'), fullPage: true })
  await page.setContent(buildPrintableReportHtml(report, { embedded: true, compactPrint: true }))
  const after = await readLayout()
  expect(after).toEqual(before)
  expect(await page.locator('.empty-cell-run svg').count()).toBeGreaterThan(0)
  await expect(page.locator('.empty-cell-run path').first()).toHaveCSS('stroke', 'rgb(230, 235, 240)')
  await page.screenshot({ path: info.outputPath('print-compact.png'), fullPage: true })
})
