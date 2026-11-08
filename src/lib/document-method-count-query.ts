import type { RemoteSystemDocumentHistoryFilterOptionsRequest } from '@/server/system-documents'
import type { SystemDocumentType } from './system-document-types'
import { GENERATED_DOCUMENT_HISTORY_QUERY_KEY } from './weld-query-utils'

/** Method-tab counts describe the same facet for every selected method. */
export function documentMethodCountQuery({ viewId, type, columnFilters, gridSearch, documentId }: {
  viewId: string
  type: SystemDocumentType
  columnFilters: Record<string, string>
  gridSearch: string
  documentId?: number | null
}) {
  const filters = { ...columnFilters }
  delete filters.method
  const request = {
    type, fieldKey: 'method', columnFilters: filters, gridSearch,
    ...(documentId ? { documentId } : {}),
  } satisfies RemoteSystemDocumentHistoryFilterOptionsRequest
  // Keep the cache identity and RPC scope together: changing only the method
  // must not reload identical counts. Document invalidation still uses the
  // existing generated-documents query prefix.
  return { request, queryKey: [...GENERATED_DOCUMENT_HISTORY_QUERY_KEY, 'grid-method-counts', viewId, request] as const }
}
