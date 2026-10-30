import { userSessionStorage } from '@/lib/user-storage'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GENERATED_DOCUMENT_HISTORY_QUERY_KEY } from '@/lib/weld-query-utils'
import { isDocumentHistoryGroupRow, type DocumentHistoryGridRequest, type DocumentHistoryGridResult } from '@/lib/document-history-grid'

const STORAGE_PREFIX = 'welding-journal:documents:session:v1:'
const EMPTY_REQUEST: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
const SELECTION_HYDRATION_BATCH_SIZE = 10_000

function readSelection(viewId: string): Array<string | number> {
  if (typeof window === 'undefined') return []
  try {
    const value: unknown = JSON.parse(userSessionStorage.getItem(`${STORAGE_PREFIX}${viewId}`) ?? '{}')
    if (!value || typeof value !== 'object' || !('selectedDocumentIds' in value) || !Array.isArray(value.selectedDocumentIds)) return []
    return [...new Set(value.selectedDocumentIds.filter((id): id is string | number =>
      typeof id === 'string' ? id.length > 0 && id.length <= 500 : typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
    ))]
  } catch { return [] }
}

/** Bridges existing document invalidations to AG's bounded store, without caching a second copy of its rows. */
export function useDocumentGridController<T extends { id: string | number }>(
  viewId: string,
  loadRows: (request: DocumentHistoryGridRequest) => Promise<DocumentHistoryGridResult<T>>,
  scopeKey = '',
) {
  const client = useQueryClient()
  const queryKey = [...GENERATED_DOCUMENT_HISTORY_QUERY_KEY, 'grid-revision', viewId]
  const revision = useQuery({
    queryKey, queryFn: async () => (client.getQueryData<number>(queryKey) ?? 0) + 1, initialData: 0,
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  // Retain only identities. Selecting a whole registry must not load or persist its cards.
  const [selectedDocuments, setDocuments] = useState<Array<{ id: string | number }>>(() => readSelection(viewId).map(id => ({ id })))
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [selectionPending, setSelectionPending] = useState(false)
  const loadRef = useRef(loadRows); loadRef.current = loadRows
  const selectionRef = useRef(selectedDocuments); selectionRef.current = selectedDocuments
  const editRevision = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; editRevision.current++ } }, [])
  useEffect(() => { editRevision.current++; setSelectionPending(false); setSelectionError(null) }, [viewId, scopeKey, revision.data])

  const setSelectedDocuments = useCallback((documents: readonly { id: string | number }[]) => {
    editRevision.current++
    const distinct = [...new Set(documents.map(document => document.id))].map(id => ({ id }))
    selectionRef.current = distinct
    setDocuments(distinct); setSelectionError(null); setSelectionPending(false)
    try {
      userSessionStorage.setItem(`${STORAGE_PREFIX}${viewId}`, JSON.stringify({ selectedDocumentIds: distinct.map(document => document.id) }))
    } catch { /* Selection remains usable when storage is unavailable. */ }
  }, [viewId])

  const resolveDocuments = useCallback(async (selection: readonly { id: string | number }[] = selectionRef.current): Promise<T[] | null> => {
    const generation = ++editRevision.current, load = loadRef.current
    const ids = [...new Set(selection.map(row => row.id))], rows: T[] = []
    const active = () => mounted.current && editRevision.current === generation
    setSelectionPending(true); setSelectionError(null)
    let snapshot: string | undefined
    try {
      for (let start = 0; start < ids.length; start += SELECTION_HYDRATION_BATCH_SIZE) {
        const result = await load({ ...EMPTY_REQUEST, selectedIds: ids.slice(start, start + SELECTION_HYDRATION_BATCH_SIZE), selectionOnly: true, revision: snapshot })
        if (!active()) return null
        snapshot = result.revision
        rows.push(...result.rows.filter((row): row is T => !isDocumentHistoryGroupRow(row)))
      }
      const byId = new Map(rows.map(row => [row.id, row]))
      if (rows.length !== ids.length || byId.size !== ids.length || ids.some(id => !byId.has(id))) {
        throw new Error('Часть выбранных документов больше недоступна. Обновите выбор перед действием.')
      }
      return ids.map(id => byId.get(id)!)
    } catch (error) {
      if (active()) setSelectionError(error instanceof Error ? error.message : 'Не удалось загрузить выбранные документы. Повторите действие.')
      return null
    } finally { if (active()) setSelectionPending(false) }
  }, [])

  return {
    selectedDocuments, setSelectedDocuments, resolveDocuments, selectionError, selectionPending,
    sourceRevision: revision.data,
    refresh: () => { void client.invalidateQueries({ queryKey }) },
  }
}
