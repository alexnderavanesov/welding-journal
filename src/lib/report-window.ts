import { buildExportXlsxBytes, type ExportWorkbookOptions } from '@/lib/weld-import-export'
import { buildLnkReportHtml } from '@/lib/report-window-html'
import type { WeldInput } from '@/lib/weld-fields'

export { buildLnkReportHtml } from '@/lib/report-window-html'

type OpenTabularReportWindowOptions = {
  rows: WeldInput[]
  fields: NonNullable<ExportWorkbookOptions['fields']>
  sheetName: string
  title: string
  filename: string
}

type OpenNonEmptyTabularReportWindowOptions = OpenTabularReportWindowOptions & {
  emptyMessage: string
  blockedMessage?: string
}

export function openTabularReportWindow({ rows, fields, sheetName, title, filename }: OpenTabularReportWindowOptions) {
  const bytes = buildExportXlsxBytes(rows, { fields, sheetName })
  const reportWindow = window.open('', '_blank')
  if (!reportWindow) return false

  reportWindow.document.open()
  reportWindow.document.write(buildLnkReportHtml(rows, bytes, title, filename, fields))
  reportWindow.document.close()
  return true
}

export function openNonEmptyTabularReportWindow({
  rows,
  fields,
  sheetName,
  title,
  filename,
  emptyMessage,
  blockedMessage = 'Браузер заблокировал открытие новой вкладки',
}: OpenNonEmptyTabularReportWindowOptions) {
  if (rows.length === 0) return { ok: false as const, message: emptyMessage }

  const opened = openTabularReportWindow({ rows, fields, sheetName, title, filename })
  return opened ? { ok: true as const } : { ok: false as const, message: blockedMessage }
}
