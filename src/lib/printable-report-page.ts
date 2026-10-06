import type { PrintableReport } from './printable-report'

export const REPORT_PREVIEW_PAGE_SIZE = 100

/** Slice across tables, retaining their headings and row styles. Never mutate the full report. */
export function getPrintableReportPage(report: PrintableReport, requestedPage: number) {
  const total = (report.tables ?? []).reduce((count, table) => count + table.rows.length, 0)
  const pageCount = Math.max(1, Math.ceil(total / REPORT_PREVIEW_PAGE_SIZE))
  const page = Math.min(Math.max(0, Math.floor(requestedPage) || 0), pageCount - 1)
  const start = page * REPORT_PREVIEW_PAGE_SIZE
  const end = Math.min(total, start + REPORT_PREVIEW_PAGE_SIZE)
  let offset = 0
  const tables = (report.tables ?? []).flatMap(table => {
    const from = Math.max(0, start - offset)
    const to = Math.min(table.rows.length, end - offset)
    offset += table.rows.length
    if (to <= from) return []
    let subtitle = table.subtitle
    if (from > 0 && table.rowKinds?.[from] === 'detail') {
      for (let index = from - 1; index >= 0; index--) {
        if (table.rowKinds[index] !== 'group') continue
        subtitle = `${subtitle ? `${subtitle} ` : ''}Продолжение группы: ${table.rows[index][0]}.`
        break
      }
    }
    return [{ ...table, subtitle, rows: table.rows.slice(from, to), rowKinds: table.rowKinds?.slice(from, to) }]
  })
  return { report: total > REPORT_PREVIEW_PAGE_SIZE ? { ...report, tables } : report, page, pageCount, start, end, total }
}
