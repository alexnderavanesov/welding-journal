import type { WeldRow } from '@/lib/dispatcher-types'
import {
  createWeldingJournalBlobFromTemplate,
  loadDocumentTemplate,
  type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import {
  downloadGeneratedDocument,
  openGeneratedDocument,
  type GeneratedDocumentPreviewRecord,
} from '@/lib/generated-document-storage'
import {
  buildSystemDocumentSummaries,
  createSystemDocumentTemplateContext,
  getSystemDocumentReferenceForField,
  type SystemDocumentReference,
  type SystemDocumentSummary,
  type SystemDocumentType,
} from '@/lib/system-document-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import { getSystemDocumentRows, listSystemDocuments } from '@/server/system-documents'

const SYSTEM_DOCUMENT_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function loadSystemDocuments(type: SystemDocumentType) {
  return listSystemDocuments({ data: { type } })
}

export function loadSystemDocumentRows(reference: SystemDocumentReference) {
  return getSystemDocumentRows({ data: reference })
}

export async function createCurrentSystemDocumentBlob({
  reference,
  summary,
  rows,
  welderStamps,
  template,
}: {
  reference: SystemDocumentReference
  summary?: SystemDocumentSummary
  rows?: WeldRow[]
  welderStamps: WelderStampRecord[]
  template?: StoredDocumentTemplate | null
}) {
  const currentTemplate = template === undefined
    ? await loadDocumentTemplate(reference.type)
    : template
  if (!currentTemplate || !['xlsx', 'xls'].includes(currentTemplate.fileType)) {
    throw new Error('Шаблон системного документа не загружен.')
  }

  const currentRows = rows ?? await loadSystemDocumentRows(reference)
  if (currentRows.length === 0) throw new Error('В документе больше нет стыков.')
  const currentSummary =
    summary ??
    buildSystemDocumentSummaries(currentRows, reference.type).find(
      (candidate) =>
        candidate.title === reference.title &&
        candidate.date === reference.date &&
        candidate.methodCode === reference.methodCode,
    )
  const methodCodes =
    currentSummary?.methodCodes ??
    (reference.methodCode ? [reference.methodCode] : [])

  return createWeldingJournalBlobFromTemplate(currentTemplate, currentRows, {
    welderStamps,
    systemDocument: createSystemDocumentTemplateContext(reference, methodCodes),
  })
}

export function openSystemDocument({
  reference,
  summary,
  welderStamps,
  template,
}: {
  reference: SystemDocumentReference
  summary?: SystemDocumentSummary
  welderStamps: WelderStampRecord[]
  template?: StoredDocumentTemplate | null
}) {
  const previewRecord = createSystemDocumentPreviewRecord(reference)
  return openGeneratedDocument(previewRecord, () =>
    createCurrentSystemDocumentBlob({
      reference,
      summary,
      welderStamps,
      template,
    }),
  )
}

export function downloadSystemDocument({
  reference,
  summary,
  welderStamps,
  template,
}: {
  reference: SystemDocumentReference
  summary?: SystemDocumentSummary
  welderStamps: WelderStampRecord[]
  template?: StoredDocumentTemplate | null
}) {
  const previewRecord = createSystemDocumentPreviewRecord(reference)
  return downloadGeneratedDocument(previewRecord, () =>
    createCurrentSystemDocumentBlob({
      reference,
      summary,
      welderStamps,
      template,
    }),
  )
}

export function openSystemDocumentForRow(
  row: WeldRow,
  fieldKey: WeldFieldKey,
  welderStamps: WelderStampRecord[],
) {
  const reference = getSystemDocumentReferenceForField(row, fieldKey)
  if (!reference) return
  return openSystemDocument({ reference, welderStamps })
}

function createSystemDocumentPreviewRecord(
  reference: SystemDocumentReference,
): GeneratedDocumentPreviewRecord {
  const fileName = `${sanitizeFileName(reference.title)}.xlsx`
  return {
    title: reference.title,
    fileName,
    mimeType: SYSTEM_DOCUMENT_MIME_TYPE,
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'Документ'
}
