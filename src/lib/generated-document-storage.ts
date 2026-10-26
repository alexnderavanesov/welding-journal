import {
  deleteRemoteGeneratedDocument,
  getRemoteGeneratedDocument,
  getRemoteGeneratedDocumentSequence,
  getRemoteGeneratedDocumentRows,
  listRemoteGeneratedDocumentHistoryFilterOptions,
  listRemoteGeneratedDocumentHistoryGrid,
  resetRemoteGeneratedDocumentSequence,
  saveRemoteGeneratedDocuments,
  type RemoteGeneratedDocument,
  type RemoteGeneratedDocumentHistoryFilterOptionsRequest,
  type RemoteGeneratedDocumentHistoryGridRequest,
  type SaveGeneratedDocumentInput,
} from '@/server/generated-documents'
import { GENERATED_DOCUMENT_STORAGE_EVENT } from '@/lib/document-storage-events'
import { createZipBlob } from '@/lib/weld-export-zip'

export type StoredGeneratedDocument = RemoteGeneratedDocument

export type GeneratedDocumentPreviewRecord = Pick<
  StoredGeneratedDocument,
  'title' | 'fileName' | 'mimeType'
>

export async function saveGeneratedDocuments(inputs: SaveGeneratedDocumentInput[]) {
  const records = await saveRemoteGeneratedDocuments({ data: inputs })
  if (records.length > 0) notifyGeneratedDocumentStorageChanged()
  return records
}

export async function loadGeneratedDocumentHistoryGrid(request: RemoteGeneratedDocumentHistoryGridRequest) {
  return listRemoteGeneratedDocumentHistoryGrid({ data: request })
}

export async function loadGeneratedDocumentHistoryFilterOptions(
  request: RemoteGeneratedDocumentHistoryFilterOptionsRequest,
) {
  return listRemoteGeneratedDocumentHistoryFilterOptions({ data: request })
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

export async function deleteGeneratedDocument(id: number, expectedUpdatedAt: string) {
  await deleteRemoteGeneratedDocument({ data: { id, expectedUpdatedAt } })
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

export async function downloadGeneratedDocument(
  documentRecord: GeneratedDocumentPreviewRecord,
  createDocumentBlob: () => Promise<Blob>,
) {
  const blob = await createDocumentBlob()
  downloadBlob(blob, getGeneratedDocumentFileName(documentRecord))
}

export async function downloadGeneratedDocumentArchive(
  documents: Array<{
    record: GeneratedDocumentPreviewRecord
    createDocumentBlob: () => Promise<Blob>
  }>,
  archiveFileName = 'documents.zip',
) {
  const usedNames = new Map<string, number>()
  const files = []
  for (const documentRecord of documents) {
    const blob = await documentRecord.createDocumentBlob()
    const fileName = getUniqueArchiveFileName(
      getGeneratedDocumentFileName(documentRecord.record),
      usedNames,
    )
    files.push({
      path: fileName,
      content: await blob.arrayBuffer(),
    })
  }
  downloadBlob(createZipBlob(files), archiveFileName)
}

function notifyGeneratedDocumentStorageChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(GENERATED_DOCUMENT_STORAGE_EVENT))
}

export function getGeneratedDocumentFileName(documentRecord: GeneratedDocumentPreviewRecord) {
  const value = String(documentRecord.fileName || documentRecord.title || 'Сварочный журнал').trim()
  const baseName = value.replace(/\.xlsx$/i, '').trim() || 'Сварочный журнал'
  return `${baseName}.xlsx`
}

export function getUniqueArchiveFileName(fileName: string, usedNames: Map<string, number>) {
  const normalized = fileName
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim() || 'Документ.xlsx'
  const extensionMatch = normalized.match(/(\.[^.]+)$/)
  const extension = extensionMatch?.[1] ?? ''
  const baseName = extension ? normalized.slice(0, -extension.length) : normalized
  let candidate = normalized
  let suffix = 2
  while (usedNames.has(getArchiveFileNameIdentity(candidate))) {
    candidate = `${baseName} (${suffix})${extension}`
    suffix += 1
  }
  usedNames.set(getArchiveFileNameIdentity(candidate), 1)
  return candidate
}

function getArchiveFileNameIdentity(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU')
}
