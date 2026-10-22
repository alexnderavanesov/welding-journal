import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { readJournalGrid, getJournalReportSummary } from '@/server/journal-grid-api'
import { type WeldReportSummaryResult, type WeldSort } from '@/server/weld-read-api'
import { splitReportQuickSearch } from './report-quick-search'
import { subscribeWeldPageRefresh } from './weld-page-refresh'
import type { WeldRow } from './dispatcher-types'
import type { JournalGridRequest, JournalGridResult, JournalRevision } from './journal-server-grid'

export type JournalServerSource = {
  identity: string
  columnFilters: Record<string, string>
  sort: WeldSort | null
  load: (request: Pick<JournalGridRequest, 'groupBy' | 'route' | 'start' | 'end'>, signal?: AbortSignal) => Promise<JournalGridResult>
  rowsChanged: (rows: WeldRow[]) => void
  error?: Error | null
  retry?: () => void
}
const noop = () => undefined
export function useJournalServerQuery(options: { enabled: boolean; columnFilters: Record<string, string>; sort: WeldSort | null }) {
  const client = useQueryClient()
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<{ identity: string; rows: WeldRow[]; ready: boolean; error: Error | null; summary?: WeldReportSummaryResult; summaryError?: Error }>({ identity: '', rows: [], ready: false, error: null })
  const filters = useMemo(() => JSON.stringify(Object.fromEntries(Object.entries(options.columnFilters).filter(([, value]) => value.trim()).sort(([a], [b]) => a.localeCompare(b)))), [options.columnFilters])
  const requestedIdentity = useMemo(() => JSON.stringify([options.enabled, filters, options.sort, generation]), [options.enabled, filters, options.sort, generation])
  // Only typing waits. Checkbox filters, sort and explicit refresh apply now,
  // also committing any search draft already typed by the user.
  const immediate = useMemo(() => JSON.stringify([options.enabled, Object.entries(options.columnFilters).filter(([key, value]) => key !== 'search' && value.trim()).sort(([a], [b]) => a.localeCompare(b)), options.sort, generation]), [options.enabled, options.columnFilters, options.sort, generation])
  const [applied, setApplied] = useState({ immediate, identity: requestedIdentity })
  useEffect(() => {
    const timer = setTimeout(() => setApplied({ immediate, identity: requestedIdentity }), applied.immediate === immediate ? 180 : 0)
    return () => clearTimeout(timer)
  }, [requestedIdentity, immediate, applied.immediate])
  const identity = applied.immediate === immediate ? applied.identity : requestedIdentity
  const current = useRef(requestedIdentity); current.current = requestedIdentity
  const revision = useRef<{ identity: string; value: JournalRevision } | null>(null)
  const summaryRequest = useRef<{ key: string; promise: Promise<WeldReportSummaryResult> } | null>(null)
  const columnFilters = useMemo<Record<string, string>>(() => JSON.parse(filters), [filters])
  const automaticRetry = useRef('')
  const refetch = useCallback(async () => {
    automaticRetry.current = ''
    summaryRequest.current = null
    // A saved joint can change facet values/counts immediately. Only refresh
    // open roots; closed popups stay lazy and revision-pinned match pages are
    // replaced by their new key when the first page receives a new revision.
    const facets = { queryKey: ['weld-column-filter-options', 'weldingJournal'],
      predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[5] !== 'matches' }
    void client.cancelQueries(facets)
    void client.invalidateQueries(facets)
    setGeneration(value => value + 1)
    return true
  }, [client])
  useEffect(() => {
    if (!options.enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribeWeldPageRefresh(client, () => { clearTimeout(timer); timer = setTimeout(() => { void refetch() }, 80) })
    return () => { unsubscribe(); clearTimeout(timer) }
  }, [client, options.enabled, refetch])
  const loadSummary = useCallback(async (scope: string, version?: JournalRevision) => {
    const key = JSON.stringify([filters, version])
    if (summaryRequest.current?.key !== key) summaryRequest.current = {
      key, promise: getJournalReportSummary({ data: { report: 'weldingJournal', ...splitReportQuickSearch(columnFilters) } }),
    }
    try {
      const summary = await summaryRequest.current.promise
      if (current.current === scope) setState(previous => previous.summary === summary && !previous.summaryError ? previous : ({ ...previous, summary, summaryError: undefined }))
    } catch (error) {
      if (current.current === scope) setState(previous => ({ ...previous, summaryError: error as Error }))
    }
  }, [columnFilters, filters])
  const load = useCallback<JournalServerSource['load']>(async (request, signal) => {
    const scope = identity
    const revisionScope = JSON.stringify([scope, request.groupBy])
    if (!options.enabled || scope !== current.current) throw new DOMException('Выборка журнала обновляется.', 'AbortError')
    try {
      const result = await readJournalGrid({ data: { ...request, columnFilters, sort: options.sort,
        revision: revision.current?.identity === revisionScope ? revision.current.value : undefined }, signal })
      if (scope !== current.current || signal?.aborted) throw new DOMException('Загрузка отменена: выборка изменилась.', 'AbortError')
      if (revision.current?.identity === revisionScope && revision.current.value !== result.revision) throw new Error('Данные журнала изменились. Обновите таблицу и повторите действие.')
      revision.current = { identity: revisionScope, value: result.revision }
      // A successful neighbouring block must not hide an unresolved failure.
      setState(previous => previous.identity === scope ? previous : { rows: [], identity: scope, ready: true, error: null })
      void loadSummary(scope, result.revision)
      return result
    } catch (error) {
      if (scope === current.current && !signal?.aborted) {
        const retryKey = JSON.stringify([filters, options.sort])
        if ((error as Error).message === 'Данные журнала изменились. Обновите таблицу и повторите действие.' && automaticRetry.current !== retryKey) {
          automaticRetry.current = retryKey
          setGeneration(value => value + 1)
          throw new DOMException('Обновление версии журнала', 'AbortError')
        }
        setState(previous => ({ ...previous, identity: scope, ready: false, error: error as Error }))
      }
      throw error
    }
  }, [identity, options.enabled, options.sort, columnFilters, filters, loadSummary])
  const rowsChanged = useCallback((rows: WeldRow[]) => {
    if (current.current !== identity) return
    setState(previous => previous.identity !== identity || previous.rows.length === rows.length && previous.rows.every((row, index) => row === rows[index]) ? previous : { ...previous, rows })
  }, [identity])
  const error = state.identity === requestedIdentity ? state.error : null
  const summaryError = state.identity === requestedIdentity ? state.summaryError : undefined
  const source = useMemo<JournalServerSource>(() => ({ identity, columnFilters, sort: options.sort, load, rowsChanged, error, retry: refetch }), [identity, columnFilters, options.sort, load, rowsChanged, error, refetch])
  const ready = options.enabled && identity === requestedIdentity && state.identity === identity && state.ready
  return {
    source, rows: ready ? state.rows : [], rowsReady: ready, requestedIdentity,
    totalCount: ready ? state.summary?.total : undefined,
    acceptedWdiTotal: ready ? state.summary?.acceptedWdiTotal : undefined,
    availableRequestCount: undefined,
    summaryStatus: (error || summaryError ? 'error' : ready && state.summary ? 'ready' : 'pending') as 'error' | 'ready' | 'pending',
    summaryError,
    retrySummary: () => { summaryRequest.current = null; void loadSummary(identity) },
    firstItemNumber: state.rows.length ? 1 : 0, lastItemNumber: state.rows.length,
    pageSize: 100, hasMore: false, isFetching: !ready, isLoading: options.enabled && !ready,
    error, loadMore: noop, setPageSize: noop, refetch,
  }
}
