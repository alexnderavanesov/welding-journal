import { formatReportFieldValue } from '@/lib/weld-export-utils'
import type { PrintableReport } from '@/lib/printable-report'
import type { ExportWorkbookOptions } from '@/lib/weld-export-types'
import type { WeldInput } from '@/lib/weld-fields'

export type ReportPreviewContent = { report: PrintableReport; onDownloadExcel?: () => Promise<void> }

/** The preview and Excel use the same snapshot; downloading never reloads the report. */
export function buildTabularReport({ rows, fields, sheetName, title, filename, emptyMessage }: {
  rows: WeldInput[]
  fields: NonNullable<ExportWorkbookOptions['fields']>
  sheetName: string
  title: string
  filename: string
  emptyMessage: string
}): ReportPreviewContent {
  return {
    report: {
      title,
      meta: [{ label: 'Строк', value: String(rows.length) }],
      emptyMessage,
      tables: rows.length ? [{
        title: '',
        columns: fields.map(field => field.label),
        rows: rows.map(row => fields.map(field => {
          const value = formatReportFieldValue(row, field)
          return typeof value === 'number' ? value : String(value)
        })),
      }] : [],
    },
    onDownloadExcel: rows.length ? async () => {
      const { buildExportXlsxBytes } = await import('@/lib/weld-export-xlsx-xml')
      const bytes = buildExportXlsxBytes(rows, { fields, sheetName })
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }))
      const link = document.createElement('a')
      link.href = url; link.download = filename
      document.body.appendChild(link)
      try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } : undefined,
  }
}
