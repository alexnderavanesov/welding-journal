import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { readJournalGrid, getJournalReportSummary } from '@/server/journal-grid-api'
import { type WeldReportSummaryResult, type WeldSort } from '@/server/weld-read-api'
import { splitReportQuickSearch } from './report-quick-search'
import { subscribeWeldPageRefresh } from './weld-page-refresh'
import type { WeldRow } from './dispatcher-types'
import { journalReport, type JournalGridRequest, type JournalGridResult, type JournalRevision } from './journal-server-grid'

export type JournalServerSource = {
  report?: JournalGridRequest['report']
  identity: string
  columnFilters: Record<string, string>
  sort: WeldSort | null
  load: (request: Pick<JournalGridRequest, 'groupBy' | 'route' | 'start' | 'end'>, signal?: AbortSignal) => Promise<JournalGridResult>
  rowsChanged: (rows: WeldRow[]) => void
  error?: Error | null
  retry?: () => void
}
export function useJournalServerQuery(options: { report?: JournalGridRequest['report']; enabled: boolean; columnFilters: Record<string, string>; sort: WeldSort | null }) {
  const report = journalReport(options.report)
  const client = useQueryClient()
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<{ identity: string; rows: WeldRow[]; ready: boolean; modelPending?: boolean; error: Error | null; summary?: WeldReportSummaryResult; summaryError?: Error }>({ identity: '', rows: [], ready: false, error: null })
  const filters = useMemo(() => JSON.stringify(Object.fromEntries(Object.entries(options.columnFilters).filter(([, value]) => value.trim()).sort(([a], [b]) => a.localeCompare(b)))), [options.columnFilters])
  // User selection changes invalidate output; background row refreshes do not
  // invalidate an independently prepared, coherent report snapshot.
  const selectionIdentity = useMemo(() => JSON.stringify([report, options.enabled, filters, options.sort]), [report, options.enabled, filters, options.sort])
  const requestedIdentity = useMemo(() => JSON.stringify([report, options.enabled, filters, options.sort, generation]), [report, options.enabled, filters, options.sort, generation])
  // Only typing waits. Checkbox filters, sort and explicit refresh apply now,
  // also committing any search draft already typed by the user.
  const immediate = useMemo(() => JSON.stringify([report, options.enabled, Object.entries(options.columnFilters).filter(([key, value]) => key !== 'search' && value.trim()).sort(([a], [b]) => a.localeCompare(b)), options.sort, generation]), [report, options.enabled, options.columnFilters, options.sort, generation])
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
    const facets = { queryKey: ['weld-column-filter-options', report],
      predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[5] !== 'matches' }
    void client.cancelQueries(facets)
    void client.invalidateQueries(facets)
    setGeneration(value => value + 1)
    return true
  }, [client, report])
  useEffect(() => {
    if (!options.enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribeWeldPageRefresh(client, () => {
      // Coalesce the reads, but disable actions on the saved row version now.
      // Otherwise a fast second command can open a menu during the debounce
      // and lose it when the replacement block arrives.
      setState(previous => previous.ready || previous.modelPending ? { ...previous, ready: false, modelPending: false } : previous)
      clearTimeout(timer); timer = setTimeout(() => { void refetch() }, 80)
    })
    return () => { unsubscribe(); clearTimeout(timer) }
  }, [client, options.enabled, refetch])
  const loadSummary = useCallback(async (scope: string, version?: JournalRevision) => {
    const key = JSON.stringify([report, filters, version])
    if (summaryRequest.current?.key !== key) summaryRequest.current = {
      key, promise: getJournalReportSummary({ data: { report, ...splitReportQuickSearch(columnFilters) } }),
    }
    try {
      const summary = await summaryRequest.current.promise
      if (current.current === scope) setState(previous => previous.summary === summary && !previous.summaryError ? previous : ({ ...previous, summary, summaryError: undefined }))
    } catch (error) {
      if (current.current === scope) setState(previous => ({ ...previous, summaryError: error as Error }))
    }
  }, [report, columnFilters, filters])
  const load = useCallback<JournalServerSource['load']>(async (request, signal) => {
    const scope = identity
    const revisionScope = JSON.stringify([scope, request.groupBy])
    if (!options.enabled || scope !== current.current) throw new DOMException('Выборка журнала обновляется.', 'AbortError')
    try {
      const result = await readJournalGrid({ data: { ...request, report, columnFilters, sort: options.sort,
        revision: revision.current?.identity === revisionScope ? revision.current.value : undefined }, signal })
      if (scope !== current.current || signal?.aborted) throw new DOMException('Загрузка отменена: выборка изменилась.', 'AbortError')
      if (revision.current?.identity === revisionScope && revision.current.value !== result.revision) throw new Error('Данные журнала изменились. Обновите таблицу и повторите действие.')
      revision.current = { identity: revisionScope, value: result.revision }
      // A successful neighbouring block must not hide an unresolved failure.
      // The response is not yet installed in AG Grid. Keep actions disabled
      // until rowsChanged publishes the committed model, including empty groups.
      setState(previous => previous.identity === scope ? previous : { rows: [], identity: scope, ready: false, modelPending: true, error: null })
      void loadSummary(scope, result.revision)
      return result
    } catch (error) {
      if (scope === current.current && !signal?.aborted) {
        const retryKey = JSON.stringify([report, filters, options.sort])
        if ((error as Error).message === 'Данные журнала изменились. Обновите таблицу и повторите действие.' && automaticRetry.current !== retryKey) {
          automaticRetry.current = retryKey
          setGeneration(value => value + 1)
          throw new DOMException('Обновление версии журнала', 'AbortError')
        }
        setState(previous => ({ ...previous, identity: scope, ready: false, error: error as Error }))
      }
      throw error
    }
  }, [report, identity, options.enabled, options.sort, columnFilters, filters, loadSummary])
  const rowsChanged = useCallback((rows: WeldRow[]) => {
    if (current.current !== identity) return
    setState(previous => previous.identity !== identity || previous.error || !previous.ready && !previous.modelPending
      || previous.ready && previous.rows.length === rows.length && previous.rows.every((row, index) => row === rows[index])
      ? previous : { ...previous, rows, ready: true, modelPending: false })
  }, [identity])
  const error = state.identity === requestedIdentity ? state.error : null
  const summaryError = state.identity === requestedIdentity ? state.summaryError : undefined
  const source = useMemo<JournalServerSource>(() => ({ report, identity, columnFilters, sort: options.sort, load, rowsChanged, error, retry: refetch }), [report, identity, columnFilters, options.sort, load, rowsChanged, error, refetch])
  const ready = options.enabled && identity === requestedIdentity && state.identity === identity && state.ready
  return {
    source, rows: ready ? state.rows : [], rowsReady: ready, requestedIdentity, selectionIdentity,
    totalCount: ready ? state.summary?.total : undefined,
    acceptedWdiTotal: ready ? state.summary?.acceptedWdiTotal : undefined,
    availableRequestCount: ready ? state.summary?.availableRequestCount : undefined,
    summaryStatus: (error || summaryError ? 'error' : ready && state.summary ? 'ready' : 'pending') as 'error' | 'ready' | 'pending',
    summaryError,
    retrySummary: () => { summaryRequest.current = null; void loadSummary(identity) },
    isFetching: !ready, isLoading: options.enabled && !ready, error, refetch,
  }
}
