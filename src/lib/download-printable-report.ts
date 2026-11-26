import type { PrintableReport } from './printable-report'
import { reportExcelFilename } from './report-filename'

/** Export exactly the open snapshot without loading server data again. */
export async function downloadPrintableReport(report: PrintableReport, generatedAt: string | Date = report.generatedAt ?? new Date()) {
  const { buildPrintableReportXlsx } = await import('./printable-report-xlsx')
  const bytes = buildPrintableReportXlsx(report)
  const blob = new Blob([new Uint8Array(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(blob, reportExcelFilename(report.title, generatedAt))
}

export async function downloadReportExcelResponse(response: Response) {
  const encoded = response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;\s]+)/i)?.[1]
  const filename = encoded ? decodeURIComponent(encoded) : response.headers.get('X-Report-Filename') || 'Отчёт.xlsx'
  downloadBlob(await response.blob(), filename)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  try { document.body.appendChild(link); link.click() }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
