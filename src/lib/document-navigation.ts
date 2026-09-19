import type { WeldRow } from '@/lib/dispatcher-types'
import {
  GENERATED_DOCUMENT_PROFILES,
  isGeneratedDocumentFieldKey,
  type GeneratedDocumentType,
} from '@/lib/generated-document-types'
import {
  getSystemDocumentReferenceForField,
  type SystemDocumentReference,
} from '@/lib/system-document-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type GeneratedDocumentNavigationReference = {
  kind: 'generated'
  documentId: number
  type: GeneratedDocumentType
  title: string
}

export type SystemDocumentNavigationReference = SystemDocumentReference & {
  kind: 'system'
}

export type DocumentNavigationReference =
  | GeneratedDocumentNavigationReference
  | SystemDocumentNavigationReference

export type GeneratedDocumentNavigationRequest = GeneratedDocumentNavigationReference & {
  requestId: number
}

export type DocumentNavigationRequest =
  | GeneratedDocumentNavigationRequest
  | (SystemDocumentNavigationReference & { requestId: number })

export function getDocumentNavigationReferenceForField(
  row: WeldRow,
  fieldKey: WeldFieldKey,
): DocumentNavigationReference | null {
  if (isGeneratedDocumentFieldKey(fieldKey)) {
    const entry = Object.entries(GENERATED_DOCUMENT_PROFILES).find(
      ([, profile]) => profile.fieldKey === fieldKey,
    ) as [GeneratedDocumentType, (typeof GENERATED_DOCUMENT_PROFILES)[GeneratedDocumentType]] | undefined
    if (!entry) return null

    const [type, profile] = entry
    const documentId = Number(row[profile.idKey])
    const title = String(row[profile.fieldKey] ?? '').trim()
    if (!Number.isSafeInteger(documentId) || documentId <= 0 || !title) return null

    return { kind: 'generated', documentId, type, title }
  }

  const systemReference = getSystemDocumentReferenceForField(row, fieldKey)
  return systemReference ? { kind: 'system', ...systemReference } : null
}
