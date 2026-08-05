import {
  deleteRemoteGeneratedDocument,
  getRemoteGeneratedDocument,
  getRemoteGeneratedDocumentSequence,
  getRemoteGeneratedDocumentRows,
  listRemoteGeneratedDocuments,
  resetRemoteGeneratedDocumentSequence,
  saveRemoteGeneratedDocuments,
  type RemoteGeneratedDocument,
  type SaveGeneratedDocumentInput,
} from '@/server/generated-documents'

export const GENERATED_DOCUMENT_STORAGE_EVENT = 'generated-document-storage-change'

export type StoredGeneratedDocument = RemoteGeneratedDocument

export type GeneratedDocumentPreviewRecord = Pick<
  StoredGeneratedDocument,
  'title' | 'fileName' | 'mimeType'
>

type MaterializedGeneratedDocument = GeneratedDocumentPreviewRecord & {
  fileData: ArrayBuffer
}

export async function saveGeneratedDocuments(inputs: SaveGeneratedDocumentInput[]) {
  const records = await saveRemoteGeneratedDocuments({ data: inputs })
  if (records.length > 0) notifyGeneratedDocumentStorageChanged()
  return records
}

export async function loadGeneratedDocuments() {
  return listRemoteGeneratedDocuments()
}

export async function loadGeneratedDocumentSequence(type: SaveGeneratedDocumentInput['type']) {
  return getRemoteGeneratedDocumentSequence({ data: { type } })
}

export async function resetGeneratedDocumentSequence(type: SaveGeneratedDocumentInput['type']) {
  return resetRemoteGeneratedDocumentSequence({ data: { type } })
}

export async function loadGeneratedDocumentRows(id: number) {
  return getRemoteGeneratedDocumentRows({ data: { id } })
}

export async function loadGeneratedDocument(id: number) {
  return getRemoteGeneratedDocument({ data: { id } })
}

export async function deleteGeneratedDocument(id: number) {
  await deleteRemoteGeneratedDocument({ data: { id } })
  notifyGeneratedDocumentStorageChanged()
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function openGeneratedDocument(
  documentRecord: GeneratedDocumentPreviewRecord,
  createDocumentBlob: () => Promise<Blob>,
) {
  const previewWindow = window.open('', '_blank')
  if (!previewWindow) {
    window.alert('Браузер заблокировал открытие новой вкладки.')
    return null
  }

  previewWindow.opener = null
  writeGeneratedDocumentPreview(previewWindow, buildGeneratedDocumentLoadingHtml(documentRecord))

  try {
    const blob = await createDocumentBlob()
    const materializedDocument: MaterializedGeneratedDocument = {
      ...documentRecord,
      fileData: await blob.arrayBuffer(),
    }
    const workbookPreviewHtml = await buildGeneratedDocumentPreviewHtml(materializedDocument)
    if (previewWindow.closed) return
    writeGeneratedDocumentPreview(previewWindow, workbookPreviewHtml)
  } catch (error) {
    if (previewWindow.closed) return
    writeGeneratedDocumentPreview(
      previewWindow,
      buildGeneratedDocumentErrorHtml(
        documentRecord,
        error instanceof Error ? error.message : 'Не удалось подготовить предпросмотр документа.',
      ),
    )
  }
}

export async function downloadGeneratedDocument(
  documentRecord: GeneratedDocumentPreviewRecord,
  createDocumentBlob: () => Promise<Blob>,
) {
  const blob = await createDocumentBlob()
  downloadBlob(blob, getGeneratedDocumentFileName(documentRecord))
}

function notifyGeneratedDocumentStorageChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(GENERATED_DOCUMENT_STORAGE_EVENT))
}

async function buildGeneratedDocumentPreviewHtml(documentRecord: MaterializedGeneratedDocument) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(documentRecord.fileData, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('В книге нет листов для просмотра.')

  const worksheet = workbook.Sheets[sheetName]
  const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null
  if (!range) throw new Error('Первый лист пустой.')

  const rows: string[][] = []
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: string[] = []
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })
      const cell = worksheet[cellAddress]
      row.push(cell ? XLSX.utils.format_cell(cell) : '')
    }
    rows.push(row)
  }

  return buildGeneratedDocumentTableHtml(documentRecord, sheetName, rows)
}

function writeGeneratedDocumentPreview(previewWindow: Window, html: string) {
  previewWindow.document.open()
  previewWindow.document.write(html)
  previewWindow.document.close()
}

function buildGeneratedDocumentLoadingHtml(documentRecord: GeneratedDocumentPreviewRecord) {
  return buildGeneratedDocumentShellHtml({
    documentRecord,
    content: '<div class="empty">Готовим предпросмотр документа...</div>',
    subtitle: 'Загрузка',
  })
}

function buildGeneratedDocumentErrorHtml(documentRecord: GeneratedDocumentPreviewRecord, message: string) {
  return buildGeneratedDocumentShellHtml({
    documentRecord,
    content: `<div class="empty">Предпросмотр недоступен: ${escapeHtml(message)}</div>`,
    subtitle: 'Предпросмотр недоступен',
  })
}

function buildGeneratedDocumentTableHtml(documentRecord: MaterializedGeneratedDocument, sheetName: string, rows: string[][]) {
  const downloadScript = buildGeneratedDocumentDownloadScript(documentRecord)
  const rowCount = Math.max(rows.length - 1, 0)
  const content = `
    <div class="table-wrap">
      <table>
        <tbody>
          ${rows
            .map(
              (row, rowIndex) => `
                <tr>
                  ${row
                    .map((cell) => {
                      const tag = rowIndex === 0 ? 'th' : 'td'
                      return `<${tag}>${escapeHtml(cell)}</${tag}>`
                    })
                    .join('')}
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `

  return buildGeneratedDocumentShellHtml({
    documentRecord,
    content,
    subtitle: `Лист: ${sheetName} · строк: ${rowCount}`,
    downloadScript,
  })
}

function buildGeneratedDocumentShellHtml({
  documentRecord,
  content,
  subtitle,
  downloadScript = '',
}: {
  documentRecord: GeneratedDocumentPreviewRecord
  content: string
  subtitle: string
  downloadScript?: string
}) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(documentRecord.title)}</title>
  <style>
    body { margin: 0; background: #f8fafc; color: #172033; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .page { padding: 24px; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 22px; line-height: 1.2; }
    .meta { margin-top: 6px; color: #64748b; font-size: 13px; }
    button { border: 1px solid #1e293b; border-radius: 6px; background: #172033; color: white; padding: 10px 14px; font: inherit; font-weight: 600; cursor: pointer; }
    button:hover { background: #0f172a; }
    button:disabled { cursor: wait; opacity: 0.55; }
    .table-wrap { overflow: auto; border: 1px solid #d8e0ec; border-radius: 8px; background: white; }
    table { min-width: 100%; border-collapse: collapse; }
    th, td { max-width: 360px; padding: 9px 10px; border-top: 1px solid #edf2f7; border-right: 1px solid #edf2f7; color: #24364d; font-size: 13px; text-align: left; vertical-align: top; white-space: pre-wrap; }
    th { position: sticky; top: 0; background: #d8e0ec; color: #334155; font-weight: 700; z-index: 1; }
    tr:nth-child(even) td { background: #f8fafc; }
    .empty { border: 1px solid #d8e0ec; border-radius: 8px; background: white; padding: 32px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <div>
        <h1>${escapeHtml(documentRecord.title)}</h1>
        <div class="meta">${escapeHtml(subtitle)}</div>
      </div>
      <button type="button" id="download" ${downloadScript ? '' : 'disabled'}>Скачать Excel</button>
    </div>
    ${content}
  </div>
  ${downloadScript}
</body>
</html>`
}

function buildGeneratedDocumentDownloadScript(documentRecord: MaterializedGeneratedDocument) {
  const base64 = arrayBufferToBase64(documentRecord.fileData)
  const fileName = getGeneratedDocumentFileName(documentRecord)
  return `<script>
    const base64 = "${base64}";
    document.getElementById("download").addEventListener("click", () => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const blob = new Blob([bytes], { type: "${escapeJsString(documentRecord.mimeType)}" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "${escapeJsString(fileName)}";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  </script>`
}

function getGeneratedDocumentFileName(documentRecord: GeneratedDocumentPreviewRecord) {
  const value = String(documentRecord.fileName || documentRecord.title || 'Сварочный журнал').trim()
  const baseName = value.replace(/\.xlsx$/i, '').trim() || 'Сварочный журнал'
  return `${baseName}.xlsx`
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
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
