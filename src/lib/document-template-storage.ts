import { DOCUMENT_TEMPLATE_STORAGE_EVENT, GENERATED_DOCUMENT_STORAGE_EVENT } from '@/lib/document-storage-events'
import {
  deleteRemoteDocumentTemplate,
  getRemoteDocumentTemplate,
  listRemoteDocumentTemplatesWithFiles,
  saveRemoteDocumentTemplate,
  updateRemoteDocumentTemplate,
} from '@/server/document-templates-api'

import {
  type DocumentTemplateId,
  type TemplateUploadInfo,
  type DocumentTemplateConstructorConfig,
  normalizeDocumentTemplateConstructorConfig,
  type DocumentTemplateOptions,
  type StoredDocumentTemplate,
} from '@/lib/document-template-model'

export async function saveDocumentTemplate(
  templateId: DocumentTemplateId,
  parsedTemplate: TemplateUploadInfo & { fileData: ArrayBuffer },
  options: {
    constructorConfig?: DocumentTemplateConstructorConfig | null
    expectedVersion?: string | null
  } = {},
) {
  const remote = await saveRemoteDocumentTemplate({
    data: {
      id: templateId,
      fileName: parsedTemplate.fileName,
      fileType: parsedTemplate.fileType,
      fileSize: parsedTemplate.fileSize,
      fileDataBase64: arrayBufferToBase64(parsedTemplate.fileData),
      sheetNames: parsedTemplate.sheetNames,
      fields: parsedTemplate.fields,
      markerCount: parsedTemplate.markerCount,
      locations: parsedTemplate.locations,
      warnings: parsedTemplate.warnings,
      constructorConfig: options.constructorConfig,
      expectedVersion: options.expectedVersion ?? null,
    },
  })
  const record = fromRemoteDocumentTemplate(remote)
  notifyDocumentTemplateStorageChanged()
  return record
}

export async function updateDocumentTemplateConstructor(
  templateId: DocumentTemplateId,
  constructorConfig: DocumentTemplateConstructorConfig,
  expectedVersion: string,
) {
  const saved = await updateRemoteDocumentTemplate({
    data: {
      id: templateId,
      expectedVersion,
      constructorConfig: normalizeDocumentTemplateConstructorConfig(constructorConfig),
    },
  })
  if (!saved) return null
  const record = await loadDocumentTemplate(templateId)
  notifyDocumentTemplateStorageChanged()
  return record
}

export async function updateDocumentTemplateOptions(
  templateId: DocumentTemplateId,
  options: DocumentTemplateOptions,
  expectedVersion: string,
) {
  const existingTemplate = await loadDocumentTemplate(templateId)
  if (!existingTemplate) return null

  await updateRemoteDocumentTemplate({
    data: {
      id: templateId,
      expectedVersion,
      options: {
      ...existingTemplate.options,
      ...options,
      },
    },
  })
  const record = await loadDocumentTemplate(templateId)
  notifyDocumentTemplateStorageChanged()
  return record
}

export async function loadDocumentTemplate(templateId: DocumentTemplateId) {
  const remote = await getRemoteDocumentTemplate({ data: { id: templateId } })
  return remote ? fromRemoteDocumentTemplate(remote) : undefined
}

export async function loadDocumentTemplates() {
  const records = (await listRemoteDocumentTemplatesWithFiles()).map(fromRemoteDocumentTemplate)
  return records.reduce<Partial<Record<DocumentTemplateId, StoredDocumentTemplate>>>((accumulator, record) => {
    if (record) accumulator[record.id] = record
    return accumulator
  }, {})
}

export async function deleteDocumentTemplate(templateId: DocumentTemplateId, expectedVersion: string) {
  await deleteRemoteDocumentTemplate({ data: { id: templateId, expectedVersion } })
  notifyDocumentTemplateStorageChanged()
}

function notifyDocumentTemplateStorageChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(DOCUMENT_TEMPLATE_STORAGE_EVENT))
  window.dispatchEvent(new Event(GENERATED_DOCUMENT_STORAGE_EVENT))
}

function fromRemoteDocumentTemplate(
  remote: Awaited<ReturnType<typeof getRemoteDocumentTemplate>> & { fileDataBase64: string },
): StoredDocumentTemplate {
  return {
    ...remote,
    constructorConfig: remote.constructorConfig
      ? normalizeDocumentTemplateConstructorConfig(remote.constructorConfig)
      : undefined,
    fileData: base64ToArrayBuffer(remote.fileDataBase64),
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

function base64ToArrayBuffer(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

// Stable public entry point; processing modules never import persistence.
export {
  DOCUMENT_TEMPLATE_TYPES,
  type DocumentTemplateId,
  type TemplateMarkerLocation,
  type TemplateUploadInfo,
  type WeldingJournalTemplateOptions,
  type DocumentTemplateOptions,
  type DocumentTemplateFieldKey,
  type DocumentTemplateBindingMode,
  type DocumentTemplateRepeatMode,
  type DocumentTemplateBindingScope,
  type DocumentTemplateEmptyMode,
  type DocumentTemplateFilledMode,
  type DocumentTemplateNumericOperation,
  type DocumentTemplateCellPart,
  type DocumentTemplateCellBinding,
  type DocumentTemplateConstructorConfig,
  normalizeDocumentTemplateConstructorConfig,
  convertDocumentTemplateBindingToGroupSummary,
  convertDocumentTemplateBindingToJointRow,
  type StoredDocumentTemplate,
  type DocumentTemplateReplacementStatus,
  type DocumentTemplateReplacementIssue,
  type DocumentTemplateReplacementMapping,
  type DocumentTemplateReplacementAnalysis,
  type DocumentTemplatePreviewCell,
  type DocumentTemplatePreviewCellStyle,
  type DocumentTemplateWorkbookPreview,
  DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS,
  getWeldingJournalTemplateOptions,
  type WeldingJournalTemplateContext,
  getFileExtension,
  formatFileSize,
} from '@/lib/document-template-model'
export {
  parseDocumentTemplateFile,
  downloadWeldingJournalFromTemplate,
  createWeldingJournalBlobFromTemplate,
  extractTemplateFields,
  isKnownTemplateMarkerField,
  parseTemplateMarkerToken,
} from '@/lib/document-template-workbook'
export { analyzeDocumentTemplateReplacement } from '@/lib/document-template-replacement'
export {
  readDocumentTemplateWorkbookPreview,
  createWeldingJournalDocumentPreview,
} from '@/lib/document-template-preview'
export type {
  DocumentTemplateNameConfig,
  DocumentTemplateNameFieldKey,
  DocumentTemplateNamePart,
} from '@/lib/document-template-name'
export { buildDocumentTemplateName, createDefaultDocumentTemplateNameConfig } from '@/lib/document-template-name'
