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
  buildCurrentSystemDocumentName,
  buildSystemDocumentRenameRows,
  buildSystemDocumentSummaries,
  createSystemDocumentTemplateContext,
  getSystemDocumentNumber,
  getSystemDocumentRenameNumber,
  getSystemDocumentReferenceForField,
  type SystemDocumentReference,
  type SystemDocumentSummary,
  type SystemDocumentType,
} from '@/lib/system-document-types'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { loadRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { loadSystemDocumentSequence } from '@/lib/system-document-sequence-storage'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import {
  getSystemDocumentRows,
  listSystemDocuments,
} from '@/server/system-documents'

const SYSTEM_DOCUMENT_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function loadSystemDocuments(type: SystemDocumentType) {
  return listSystemDocuments({ data: { type } })
}

export function loadSystemDocumentRows(reference: SystemDocumentReference) {
  return getSystemDocumentRows({ data: reference })
}

export async function renameSystemDocumentToCurrentName(
  reference: SystemDocumentReference | SystemDocumentSummary,
) {
  const rows = await loadSystemDocumentRows(reference)
  if (rows.length === 0) throw new Error('В документе больше нет стыков.')

  const settings = loadRequestConclusionSettings()
  const sequence = await loadSystemDocumentSequence(getSystemDocumentTemplateId(reference))
  const previousNumber = getSystemDocumentRenameNumber(
    reference,
    settings,
    sequence.nextNumber,
  )
  const usesExistingNumber = /^\d+$/.test(previousNumber)
  const provisionalName = usesExistingNumber
    ? buildCurrentSystemDocumentName(reference, rows, settings, Number(previousNumber))
    : createSystemDocumentRenameMarker(reference.type)

  if (provisionalName === reference.title) {
    return {
      previousName: reference.title,
      nextName: reference.title,
      rowCount: rows.length,
      changed: false,
    }
  }

  if (usesExistingNumber) {
    const documents = await loadSystemDocuments(reference.type)
    const conflict = documents.some(
      (documentRecord) =>
        documentRecord.id !== ('id' in reference ? reference.id : '') &&
        documentRecord.title === provisionalName &&
        documentRecord.date === reference.date &&
        documentRecord.methodCode === reference.methodCode,
    )
    if (conflict) {
      throw new Error(`Документ с именем «${provisionalName}» уже существует.`)
    }
  }

  const renamePlan = buildSystemDocumentRenameRows(reference, rows, provisionalName)
  if (renamePlan.records.length === 0 || renamePlan.fieldKeys.length === 0) {
    throw new Error('Не найдены позиции документа для переименования.')
  }

  const savedRows = await updateWeldRowsOrThrow(
    renamePlan.records,
    'Не удалось переименовать часть позиций документа.',
    usesExistingNumber
      ? {}
      : {
          systemDocumentSequence: {
            type: reference.type,
            date: reference.date,
            ...(reference.methodCode ? { methodCode: reference.methodCode } : {}),
            fieldKeys: renamePlan.fieldKeys,
            provisionalName,
          },
        },
  )
  const nextName = findRenamedSystemDocumentName(
    savedRows as unknown as WeldRow[],
    renamePlan.records,
    renamePlan.fieldKeys,
    provisionalName,
  )
  if (!nextName) throw new Error('Система не вернула новое имя документа.')
  return {
    previousName: reference.title,
    nextName,
    rowCount: rows.length,
    changed: true,
  }
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
    ? await loadDocumentTemplate(getSystemDocumentTemplateId(reference))
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
    systemDocument: createSystemDocumentTemplateContext(
      currentSummary ?? reference,
      methodCodes,
      loadRequestConclusionSettings(),
    ),
  })
}

export function openSystemDocument({
  reference,
  summary,
  welderStamps,
  template,
  previewWindow,
}: {
  reference: SystemDocumentReference
  summary?: SystemDocumentSummary
  welderStamps: WelderStampRecord[]
  template?: StoredDocumentTemplate | null
  previewWindow?: Window | null
}) {
  const previewRecord = createSystemDocumentPreviewRecord(reference)
  return openGeneratedDocument(
    previewRecord,
    () =>
      createCurrentSystemDocumentBlob({
        reference,
        summary,
        welderStamps,
        template,
      }),
    previewWindow,
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
  previewWindow?: Window | null,
) {
  const reference = getSystemDocumentReferenceForField(row, fieldKey)
  if (!reference) return
  return openSystemDocument({ reference, welderStamps, previewWindow })
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

function createSystemDocumentRenameMarker(type: SystemDocumentType) {
  return `__SYSTEM_DOCUMENT_RENAME_${type}_${Date.now()}_${Math.random().toString(36).slice(2)}__`
}

function findRenamedSystemDocumentName(
  savedRows: WeldRow[],
  requestedRows: WeldRow[],
  fieldKeys: WeldFieldKey[],
  provisionalName: string,
) {
  const savedById = new Map(savedRows.map((row) => [row.id, row]))
  for (const requestedRow of requestedRows) {
    const savedRow = savedById.get(requestedRow.id)
    if (!savedRow) continue
    for (const fieldKey of fieldKeys) {
      if (String(requestedRow[fieldKey] ?? '').trim() !== provisionalName) continue
      const value = String(savedRow[fieldKey] ?? '').trim()
      if (value && !value.startsWith('__SYSTEM_DOCUMENT_RENAME_')) return value
    }
  }
  return ''
}
