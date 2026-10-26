import { formatReportFieldValue } from '@/lib/weld-export-utils'
import type { PrintableReport } from '@/lib/printable-report'
import type { ExportWorkbookOptions } from '@/lib/weld-export-types'
import type { WeldInput } from '@/lib/weld-fields'

export type TabularReportData = { rows: WeldInput[]; fields: NonNullable<ExportWorkbookOptions['fields']>; sheetName: string; filename: string }
export type ReportPreviewContent = { report: PrintableReport; onDownloadExcel?: (signal?: AbortSignal) => Promise<void> }

/** Shared formatting and export metadata; file delivery is handled separately. */
export function buildTabularReport({ rows, fields, sheetName, title, filename, emptyMessage }: {
  rows: WeldInput[]
  fields: NonNullable<ExportWorkbookOptions['fields']>
  sheetName: string
  title: string
  filename: string
  emptyMessage: string
}) {
  return {
    exportData: { rows, fields, sheetName, filename },
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
  }
}
