import { formatReportFieldValue } from '@/lib/weld-export-utils'
import type { PrintableReport } from '@/lib/printable-report'
import type { ExportWorkbookOptions } from '@/lib/weld-export-types'
import { FIELD_BY_KEY, type WeldInput } from '@/lib/weld-fields'

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
  const createReport = () => ({
      title,
      meta: [{ label: 'Строк', value: String(rows.length) }],
      emptyMessage,
      tables: rows.length ? [{
        title: '',
        columns: fields.map(field => field.label),
        printIdentity: {
          columns: ['Линия', 'Стык'],
          indexes: ['line', 'joint'].map(key => fields.findIndex(field => field.key === key)),
          rows: rows.map(row => ['line', 'joint'].map(key => String(formatReportFieldValue(row, FIELD_BY_KEY.get(key as 'line' | 'joint')!)))),
        },
        rows: rows.map(row => fields.map(field => {
          const value = formatReportFieldValue(row, field)
          return typeof value === 'number' ? value : String(value)
        })),
      }] : [],
  })
  let report: ReturnType<typeof createReport> | undefined
  return {
    exportData: { rows, fields, sheetName, filename },
    // Complete Excel consumes only raw export rows. Avoid formatting a second,
    // discarded preview matrix for every batch of a large download.
    get report() { return report ??= createReport() },
  }
}
