import type { PrintableReport } from './printable-report'

/** Export exactly the open snapshot without loading server data again. */
export async function downloadPrintableReport(report: PrintableReport) {
  const { buildPrintableReportXlsx } = await import('./printable-report-xlsx')
  const bytes = buildPrintableReportXlsx(report)
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${report.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim() || 'Отчёт'}.xlsx`
  try { document.body.appendChild(link); link.click() }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
