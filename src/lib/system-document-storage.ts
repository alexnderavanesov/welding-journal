import type { WeldRow } from '@/lib/dispatcher-types'
import {
    createWeldingJournalBlobFromTemplate,
    loadDocumentTemplate,
    type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import {
    downloadGeneratedDocument,
    type GeneratedDocumentPreviewRecord,
} from '@/lib/generated-document-storage'
import { loadRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import {
    getSystemDocumentTemplateId,
    getSystemDocumentTemplateLoadCandidates,
} from '@/lib/system-document-template-types'
import {
    buildSystemDocumentSummaries,
    createSystemDocumentTemplateContext,
    type SystemDocumentReference,
    type SystemDocumentSummary,
} from '@/lib/system-document-types'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import {
    getSystemDocumentDateContext,
    getSystemDocumentRows,
    getSystemDocumentSpecialists,
    listSystemDocumentHistoryFilterOptions,
    listSystemDocumentHistoryGrid,
    type RemoteSystemDocumentHistoryFilterOptionsRequest,
    type RemoteSystemDocumentHistoryGridRequest,
} from '@/server/system-documents'

const SYSTEM_DOCUMENT_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function loadSystemDocumentHistoryGrid(request: RemoteSystemDocumentHistoryGridRequest) {
  return listSystemDocumentHistoryGrid({ data: request })
}

export function loadSystemDocumentHistoryFilterOptions(
  request: RemoteSystemDocumentHistoryFilterOptionsRequest,
) {
  return listSystemDocumentHistoryFilterOptions({ data: request })
}

export function loadSystemDocumentRows(reference: SystemDocumentReference) {
  return getSystemDocumentRows({ data: reference })
}

export function loadSystemDocumentDateContext(reference: SystemDocumentReference) {
  return getSystemDocumentDateContext({ data: reference })
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
    ? await loadFirstSystemDocumentTemplate(getSystemDocumentTemplateId(reference))
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

  const specialists = currentSummary?.specialists !== undefined ? currentSummary.specialists
    : reference.specialists !== undefined ? reference.specialists
    : reference.type.endsWith('Conclusion') ? await getSystemDocumentSpecialists({ data: reference }) : null

  return createWeldingJournalBlobFromTemplate(currentTemplate, currentRows, {
    welderStamps,
    systemDocument: createSystemDocumentTemplateContext(
      { ...(currentSummary ?? reference), specialists },
      methodCodes,
      loadRequestConclusionSettings(),
    ),
  })
}

async function loadFirstSystemDocumentTemplate(
  templateId: ReturnType<typeof getSystemDocumentTemplateId>,
) {
  for (const candidateId of getSystemDocumentTemplateLoadCandidates(templateId)) {
    const template = await loadDocumentTemplate(candidateId)
    if (template) return template
  }
  return undefined
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

export function createSystemDocumentPreviewRecord(
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
