import { FileSpreadsheet } from 'lucide-react'
import { useReportPreview } from '@/lib/use-report-preview'
import { downloadReportExcelResponse } from '@/lib/download-printable-report'
import type { DocumentHistoryReportRequest } from '@/lib/document-history-report'
import type { PrintableReport } from '@/lib/printable-report'
import { useAccess } from '@/lib/security-context'
import { PrintableReportPreview } from './printable-report-preview'

export function DocumentHistoryReportButton({ context, disabled, request }: {
  context: string; disabled: boolean; request: () => DocumentHistoryReportRequest
}) {
  const { can } = useAccess()
  const { open, previewProps } = useReportPreview(context)
  const show = () => open(async () => {
    // Capture this view once. Download uses the same filters/columns on fresh data.
    const captured = structuredClone(request())
    if (!captured.columns.length) throw new Error('Выберите столбцы списка документов.')
    const load = async (format: 'preview' | 'excel', signal?: AbortSignal) => {
      const response = await fetch('/api/document-history-report', { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...captured, format }) })
      if (!response.ok) throw new Error(await response.text())
      return response
    }
    const report = await (await load('preview')).json() as PrintableReport
    return { report, onDownloadExcel: async (signal?: AbortSignal) => {
      await downloadReportExcelResponse(await load('excel', signal))
    } }
  })
  return <>
    <button type="button" className="journal-button" disabled={disabled || !can('documents.export')} onClick={event => { event.currentTarget.focus({ preventScroll: true }); void show() }}><FileSpreadsheet size={15} />Показать</button>
    {previewProps ? <PrintableReportPreview {...previewProps} /> : null}
  </>
}
