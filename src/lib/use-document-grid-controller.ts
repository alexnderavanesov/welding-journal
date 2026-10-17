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
    const value: unknown = JSON.parse(window.sessionStorage.getItem(`${STORAGE_PREFIX}${viewId}`) ?? '{}')
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
  const [selectedDocuments, setDocuments] = useState<T[]>([])
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [selectionPending, setSelectionPending] = useState(false)
  const loadRef = useRef(loadRows)
  loadRef.current = loadRows
  const selectionRef = useRef<T[]>([])
  const [initialIds] = useState(() => readSelection(viewId))
  const pendingIds = useRef(initialIds)
  const editRevision = useRef(0)

  const setSelectedDocuments = useCallback((documents: T[]) => {
    editRevision.current++
    pendingIds.current = []
    const distinct = [...new Map(documents.map(document => [document.id, document])).values()]
    selectionRef.current = distinct
    setDocuments(distinct)
    try {
      // Import the old ID-only state; never persist document snapshots or versions.
      window.sessionStorage.setItem(`${STORAGE_PREFIX}${viewId}`, JSON.stringify({ selectedDocumentIds: distinct.map(document => document.id) }))
    } catch { /* Selection remains usable when storage is unavailable. */ }
  }, [viewId])

  useEffect(() => {
    const restoring = pendingIds.current.length > 0
    const ids = pendingIds.current.length ? pendingIds.current : selectionRef.current.map(document => document.id)
    if (!ids.length) { setSelectionPending(false); setSelectionError(null); return }
    let disposed = false
    const selectionRevision = editRevision.current
    // Keep every batch on the same scope, even if a render replaces loadRef
    // before this effect's cleanup cancels the old request sequence.
    const load = loadRef.current
    setSelectionError(null)
    setSelectionPending(true)
    void (async () => {
      const rows: T[] = []
      // The server limit bounds each response, not the operator's selection.
      // Hydrate sequentially and publish once; a later failure leaves the last
      // complete selection untouched and keeps actions behind the error gate.
      for (let start = 0; start < ids.length; start += SELECTION_HYDRATION_BATCH_SIZE) {
        if (disposed || restoring && editRevision.current !== selectionRevision) return rows
        const result = await load({ ...EMPTY_REQUEST, selectedIds: ids.slice(start, start + SELECTION_HYDRATION_BATCH_SIZE), selectionOnly: true })
        if (disposed) return rows
        rows.push(...result.rows.filter((row): row is T => !isDocumentHistoryGroupRow(row)))
      }
      return rows
    })().then(rows => {
      if (disposed) return
      if (restoring) {
        // A restore must never re-add IDs deselected/chosen by the operator while it was in flight.
        if (editRevision.current === selectionRevision) setSelectedDocuments(rows)
      } else {
        // A block can refresh one selected snapshot before this whole-selection response.
        // Merge fresh snapshots for IDs still selected, preserving new explicit choices.
        const requested = new Set(ids)
        const refreshed = new Map(rows.map(row => [row.id, row]))
        setSelectedDocuments(selectionRef.current.flatMap(row => requested.has(row.id)
          ? refreshed.has(row.id) ? [refreshed.get(row.id)!] : []
          : [row]))
      }
      setSelectionPending(false)
    }).catch(() => {
      if (!disposed) {
        setSelectionPending(false)
        setSelectionError('Не удалось обновить выбранные документы. Обновите историю перед действием.')
      }
    })
    return () => { disposed = true }
  }, [viewId, scopeKey, revision.data, setSelectedDocuments])

  return {
    selectedDocuments, setSelectedDocuments, selectionError, selectionPending,
    sourceRevision: revision.data,
    refresh: () => { void client.invalidateQueries({ queryKey }) },
  }
}
