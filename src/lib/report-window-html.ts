import { formatDisplayDate } from '@/lib/date-format'
import { LNK_WAITING_NK_FIELDS } from '@/lib/report-config'
import type { ExportWorkbookOptions } from '@/lib/weld-import-export'
import type { WeldField, WeldInput } from '@/lib/weld-fields'

export function buildLnkReportHtml(
  rows: WeldInput[],
  bytes: Uint8Array,
  title = 'Ожидание НК',
  filename = 'lnk-waiting-nk.xlsx',
  fields: NonNullable<ExportWorkbookOptions['fields']> = LNK_WAITING_NK_FIELDS,
) {
  const headers = fields.map((field) => field.label)
  const xlsxBase64 = bytesToBase64(bytes)
  const bodyRows = rows
    .map(
      (row) => `
        <tr>
          ${fields.map((field) => `<td>${escapeHtml(formatLnkReportCell(row[field.key], field))}</td>`).join('')}
        </tr>
      `,
    )
    .join('')

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f8fafc; color: #172033; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .page { padding: 24px; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 22px; line-height: 1.2; }
    .meta { margin-top: 4px; color: #64748b; font-size: 13px; }
    button { border: 1px solid #1e293b; border-radius: 6px; background: #172033; color: white; padding: 10px 14px; font: inherit; font-weight: 600; cursor: pointer; }
    button:hover { background: #0f172a; }
    .table-wrap { overflow: auto; border: 1px solid #d8e0ec; border-radius: 8px; background: white; }
    table { width: 100%; min-width: 1080px; border-collapse: collapse; table-layout: fixed; }
    th { background: #d8e0ec; color: #334155; font-size: 13px; font-weight: 700; text-align: center; padding: 14px 10px; border-right: 1px solid #edf2f7; }
    td { padding: 12px 10px; border-top: 1px solid #edf2f7; border-right: 1px solid #edf2f7; color: #24364d; font-size: 13px; text-align: center; }
    tr:nth-child(even) td { background: #f8fafc; }
  </style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Строк: ${rows.length}</div>
      </div>
      <button type="button" id="download">Скачать Excel</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  </div>
  <script>
    const base64 = "${xlsxBase64}";
    document.getElementById("download").addEventListener("click", () => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "${escapeJsString(filename)}";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  </script>
</body>
</html>`
}

function formatLnkReportCell(value: unknown, field: WeldField) {
  if (
    field.key === 'weldDate' ||
    field.key === 'controlDate' ||
    field.key === 'pstoRequestDate' ||
    field.key === 'pstoDate'
  ) {
    return formatDisplayDate(value)
  }
  if (field.key === 'wdi') return value ?? ''
  return value ?? ''
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function escapeJsString(value: unknown) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
}
