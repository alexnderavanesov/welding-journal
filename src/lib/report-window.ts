import { buildLnkReportHtml } from '@/lib/report-window-html'
import type { ExportWorkbookOptions } from '@/lib/weld-export-types'
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

export async function openTabularReportWindow({ rows, fields, sheetName, title, filename }: OpenTabularReportWindowOptions) {
  const reportWindow = window.open('', '_blank')
  if (!reportWindow) return false

  writeReportLoadingState(reportWindow, title)

  try {
    const { buildExportXlsxBytes } = await import('@/lib/weld-export-xlsx-xml')
    const bytes = buildExportXlsxBytes(rows, { fields, sheetName })

    reportWindow.document.open()
    reportWindow.document.write(buildLnkReportHtml(rows, bytes, title, filename, fields))
    reportWindow.document.close()
    return true
  } catch (error) {
    console.error('Failed to build report window', error)
    writeReportErrorState(reportWindow, title)
    return false
  }
}

export async function openNonEmptyTabularReportWindow({
  rows,
  fields,
  sheetName,
  title,
  filename,
  emptyMessage,
  blockedMessage = 'Браузер заблокировал открытие новой вкладки',
}: OpenNonEmptyTabularReportWindowOptions) {
  if (rows.length === 0) return { ok: false as const, message: emptyMessage }

  const opened = await openTabularReportWindow({ rows, fields, sheetName, title, filename })
  return opened ? { ok: true as const } : { ok: false as const, message: blockedMessage }
}

function writeReportLoadingState(reportWindow: Window, title: string) {
  reportWindow.document.open()
  reportWindow.document.write(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #172033; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .panel { border: 1px solid #d8e0ec; border-radius: 10px; background: white; padding: 22px 26px; box-shadow: 0 12px 36px rgb(15 23 42 / 0.08); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0; color: #64748b; }
  </style>
</head>
<body>
  <div class="panel">
    <h1>${escapeHtml(title)}</h1>
    <p>Формируем отчет...</p>
  </div>
</body>
</html>`)
  reportWindow.document.close()
}

function writeReportErrorState(reportWindow: Window, title: string) {
  reportWindow.document.open()
  reportWindow.document.write(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #172033; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .panel { max-width: 520px; border: 1px solid #fecdd3; border-radius: 10px; background: #fff1f2; padding: 22px 26px; }
    h1 { margin: 0 0 8px; font-size: 20px; color: #9f1239; }
    p { margin: 0; color: #881337; }
  </style>
</head>
<body>
  <div class="panel">
    <h1>${escapeHtml(title)}</h1>
    <p>Не удалось сформировать отчет. Закройте вкладку и попробуйте еще раз.</p>
  </div>
</body>
</html>`)
  reportWindow.document.close()
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
