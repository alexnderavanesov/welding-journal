import type { PrintableReport } from './printable-report'
export const REPORT_PREVIEW_ROW_LIMIT = 2000

/** Limit only what the dialog retains. The original report and its full-file
 * download callback remain unchanged, including group/total rows and charts. */
export function limitReportPreview(report: PrintableReport): PrintableReport {
  const total = (report.tables ?? []).reduce((sum, table) => sum + table.rows.length, 0)
  if (total <= REPORT_PREVIEW_ROW_LIMIT) return report
  let remaining = REPORT_PREVIEW_ROW_LIMIT
  return { ...report, preview: { ...report.preview, sourceRows: report.preview?.sourceRows ?? total,
    totalRows: report.preview?.totalRows ?? total, truncated: true, freshExcel: report.preview?.freshExcel ?? false },
    tables: report.tables!.flatMap(table => {
      if (!remaining) return []
      const length = Math.min(remaining, table.rows.length)
      remaining -= length
      return [{ ...table, rows: table.rows.slice(0, length), ...(table.rowKinds ? { rowKinds: table.rowKinds.slice(0, length) } : {}),
        ...(table.printIdentity ? { printIdentity: { ...table.printIdentity, rows: table.printIdentity.rows.slice(0, length) } } : {}) }]
    }),
  }
}
