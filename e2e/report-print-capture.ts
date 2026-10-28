import type { Page } from '@playwright/test'

/** Capture exactly the DOM handed to the browser print API, without an OS dialog. */
export async function captureFullReportPrint(page: Page, captureHtml = false) {
  await page.evaluate(captureHtml => {
    document.addEventListener('load', event => {
      const frame = event.target
      if (!(frame instanceof HTMLIFrameElement) || frame.title !== 'Полный отчёт для печати') return
      const target = frame.contentWindow!
      target.print = () => {
        if (captureHtml) (window as unknown as { auditFullPrintHtml: string }).auditFullPrintHtml = frame.contentDocument!.documentElement.outerHTML
        const rows = frame.contentDocument!.querySelectorAll('tbody tr')
        const logicalColumns = [...rows].map(row => [...row.querySelectorAll('td')].reduce((sum, cell) => sum + cell.colSpan, 0))
        const parts = [...frame.contentDocument!.querySelectorAll<HTMLTableElement>('table[data-print-table]')].map(table => {
          const headers = [...table.querySelectorAll('thead th')].map(cell => cell.textContent ?? '')
          const data = [...table.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')]
            .flatMap(cell => cell.colSpan > 1 ? Array<string>(cell.colSpan).fill('') : [cell.textContent ?? '']))
          return { table: Number(table.dataset.printTable), part: Number(table.dataset.printPart), headers,
            sources: table.dataset.sourceColumns!.split(',').filter(Boolean).map(Number), rows: data.length,
            minColumns: Math.min(...data.map(row => row.length)), maxColumns: Math.max(...data.map(row => row.length)),
            lastRow: data.at(-1) ?? [], joints: headers.includes('Стык') ? data.map(row => row[headers.indexOf('Стык')]) : [] }
        })
        const tables = [...new Set(parts.map(part => part.table))].map(id => {
          const bands = parts.filter(part => part.table === id), last = new Map<number, string>()
          for (const part of bands) part.sources.forEach((source, index) => { if (source >= 0) last.set(source, part.lastRow[index]) })
          return { rows: bands[0].rows, columns: last.size, lastRow: [...last].sort((a, b) => a[0] - b[0]).map(([, value]) => value).join(' ') }
        })
        document.body.dataset.fullPrint = JSON.stringify({ rows: tables.length ? tables.reduce((sum, table) => sum + table.rows, 0) : rows.length,
          lastRow: rows[rows.length - 1]?.textContent, columns: frame.contentDocument!.querySelectorAll('thead th').length,
          minColumns: Math.min(...logicalColumns), maxColumns: Math.max(...logicalColumns),
          ...(tables.length ? { lastRow: tables.at(-1)!.lastRow, columns: tables.reduce((sum, table) => sum + table.columns, 0),
            minColumns: Math.min(...tables.map(table => table.columns)), maxColumns: Math.max(...tables.map(table => table.columns)) } : {}),
          parts, physicalRows: rows.length,
          cellNodes: frame.contentDocument!.querySelectorAll('tbody td').length })
        target.dispatchEvent(new Event('afterprint'))
      }
    }, true)
  }, captureHtml)
}
