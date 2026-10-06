import type { Page } from '@playwright/test'

/** Capture exactly the DOM handed to the browser print API, without an OS dialog. */
export async function captureFullReportPrint(page: Page) {
  await page.evaluate(() => {
    document.addEventListener('load', event => {
      const frame = event.target
      if (!(frame instanceof HTMLIFrameElement) || frame.title !== 'Полный отчёт для печати') return
      const target = frame.contentWindow!
      target.print = () => {
        const rows = frame.contentDocument!.querySelectorAll('tbody tr')
        document.body.dataset.fullPrint = JSON.stringify({ rows: rows.length,
          lastRow: rows[rows.length - 1]?.textContent, columns: frame.contentDocument!.querySelectorAll('thead th').length })
        target.dispatchEvent(new Event('afterprint'))
      }
    }, true)
  })
}
