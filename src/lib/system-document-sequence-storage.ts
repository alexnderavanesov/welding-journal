import {
  getSystemDocumentSequence,
  getSystemDocumentSequences,
  resetSystemDocumentSequence,
} from '@/server/system-document-sequences'
import type { SystemDocumentType } from '@/lib/system-document-types'

export const SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY = ['system-document-sequences'] as const

export function loadSystemDocumentSequences() {
  return getSystemDocumentSequences()
}

export function loadSystemDocumentSequence(type: SystemDocumentType) {
  return getSystemDocumentSequence({ data: { type } })
}

export function resetStoredSystemDocumentSequence(type: SystemDocumentType) {
  return resetSystemDocumentSequence({ data: { type } })
}
