import type { PrintableReport } from './printable-report'

export const REPORT_PRINT_ROW_LIMIT = 1000

/** Count the complete filtered snapshot, including group/total rows, not its preview page. */
export function getReportRowCount(report: PrintableReport) {
  return (report.tables ?? []).reduce((total, table) => total + table.rows.length, 0)
}

export function getReportPrintRestriction(report: PrintableReport) {
  const rows = report.preview?.totalRows ?? getReportRowCount(report)
  return rows > REPORT_PRINT_ROW_LIMIT
    ? `В отчёте ${rows} строк. Печать в приложении доступна до ${REPORT_PRINT_ROW_LIMIT} строк. Скачайте Excel для печати или уточните фильтры.`
    : ''
}
