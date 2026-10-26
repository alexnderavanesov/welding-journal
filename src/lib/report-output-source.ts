import { readReportOutputSnapshot } from '@/server/weld-read-api'
import type { ReportOutputRequest } from '@/server/weld-contracts'

/** Capture filters, order and columns; a later download uses this selection on fresh data. */
export async function loadReportOutputSnapshot(input: ReportOutputRequest) {
  const request: ReportOutputRequest = { ...input, columnFilters: { ...input.columnFilters },
    ...(input.sort ? { sort: { ...input.sort } } : {}), ...(input.fieldKeys ? { fieldKeys: [...input.fieldKeys] } : {}) }
  const snapshot = await readReportOutputSnapshot({ data: request })
  return { ...snapshot, onDownloadExcel: async (signal?: AbortSignal) => {
    const response = await fetch('/api/report-excel', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
    if (!response.ok) throw new Error(await response.text())
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = response.headers.get('X-Report-Filename') || 'report.xlsx'
    document.body.appendChild(link)
    try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  } }
}
