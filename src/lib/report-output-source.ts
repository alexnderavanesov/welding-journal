import { readReportOutputSnapshot } from '@/server/weld-read-api'
import type { ReportOutputRequest } from '@/server/weld-contracts'
import { downloadReportExcelResponse } from './download-printable-report'

/** Capture filters, order and columns; a later download uses this selection on fresh data. */
export async function loadReportOutputSnapshot(input: ReportOutputRequest, signal?: AbortSignal) {
  const request: ReportOutputRequest = { ...input, columnFilters: { ...input.columnFilters },
    ...(input.sort ? { sort: { ...input.sort } } : {}), ...(input.fieldKeys ? { fieldKeys: [...input.fieldKeys] } : {}) }
  const snapshot = await readReportOutputSnapshot({ data: request, signal })
  return { ...snapshot, onDownloadExcel: async (signal?: AbortSignal) => {
    const response = await fetch('/api/report-excel', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
    if (!response.ok) throw new Error(await response.text())
    await downloadReportExcelResponse(response)
  } }
}
