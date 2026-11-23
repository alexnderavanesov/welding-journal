import { useQuery } from '@tanstack/react-query'
import { loadSystemDocumentDateContext } from './system-document-storage'
import { getSystemDocumentId, getSystemDocumentLookupReference, type SystemDocumentReference } from './system-document-types'

export function effectiveDocumentReference(reference: SystemDocumentReference) {
  const lookup = getSystemDocumentLookupReference(reference)
  return lookup.sourceKind ? { ...lookup, documentId: undefined } : lookup
}

export function documentContextKey(reference: SystemDocumentReference) {
  const effective = effectiveDocumentReference(reference)
  // IDs survive a rename/date change, whereas the cached rows describe one identity.
  return ['system-document-date-context', JSON.stringify([
    getSystemDocumentId(effective), getSystemDocumentId({ ...effective, documentId: undefined }),
  ])] as const
}

export function useSystemDocumentContext(reference: SystemDocumentReference) {
  return useQuery({
    queryKey: documentContextKey(reference),
    queryFn: () => loadSystemDocumentDateContext(effectiveDocumentReference(reference)),
    staleTime: Infinity, gcTime: 0, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
}
