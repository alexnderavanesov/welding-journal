import {
  getSystemDocumentSequence,
  getSystemDocumentSequences,
  resetSystemDocumentSequence,
} from '@/server/system-document-sequences'
import type { SystemDocumentTemplateId } from '@/lib/system-document-template-types'

export const SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY = ['system-document-sequences'] as const

export function loadSystemDocumentSequences() {
  return getSystemDocumentSequences()
}

export function loadSystemDocumentSequence(type: SystemDocumentTemplateId) {
  return getSystemDocumentSequence({ data: { type } })
}

export function resetStoredSystemDocumentSequence(type: SystemDocumentTemplateId) {
  return resetSystemDocumentSequence({ data: { type } })
}
