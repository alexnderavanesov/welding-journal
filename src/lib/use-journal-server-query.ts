import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { readJournalGrid, readJournalGridBlocks, getJournalReportSummary } from '@/server/journal-grid-api'
import { type WeldReportSummaryResult, type WeldSort } from '@/server/weld-read-api'
import { splitReportQuickSearch } from './report-quick-search'
import { subscribeWeldPageRefresh } from './weld-page-refresh'
import type { JournalSelectionSnapshot } from './journal-selection-summary'
import type { WeldRow } from './dispatcher-types'
import { journalReport, type JournalGridRequest, type JournalGridResult, type JournalRevision } from './journal-server-grid'
import { isJournalRevisionError, journalReadErrorMessage, JOURNAL_CHANGED_MESSAGE } from './journal-read-error'
import { createJournalLeafCache } from './journal-leaf-cache'

export type JournalServerSource = {
  report?: JournalGridRequest['report']
  identity: string
  viewIdentity?: string
  updatesAvailable?: boolean
  revisionExpired?: boolean
  getSnapshot?: () => JournalSelectionSnapshot | undefined
  columnFilters: Record<string, string>
  sort: WeldSort | null
  load: (request: Pick<JournalGridRequest, 'groupBy' | 'route' | 'start' | 'end'>, signal?: AbortSignal) => Promise<JournalGridResult>
  loadBlocks?: (groupBy: JournalGridRequest['groupBy'], blocks: import('./journal-server-grid').JournalGridBlock[], signal?: AbortSignal) => Promise<JournalGridResult[]>
  rowsChanged: (rows: WeldRow[]) => void
  error?: Error | null
  retry?: () => void
  recoverRevision?: (error: unknown) => boolean
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
  const installed = useRef('')
  const [notice, setNotice] = useState({ identity: '', expired: false })
  const expired = useRef('')
  const revision = useRef<{ identity: string; value?: JournalRevision } | null>(null)
  const leafCache = useRef(createJournalLeafCache())
  const summaryRequest = useRef<{ key: string; promise: Promise<WeldReportSummaryResult> } | null>(null)
  const columnFilters = useMemo<Record<string, string>>(() => JSON.parse(filters), [filters])
  const automaticRetry = useRef('')
  const recovering = useRef<string | null>(null)
  const recoverRevision = useCallback((error: unknown) => {
    if (!isJournalRevisionError(error)) return false
    leafCache.current.clear()
    // Several blocks/counters can reject the same expired view together.
    if (identity !== current.current || recovering.current === identity) return true
    if (installed.current === identity) {
      // Even a footer counter can discover a newer database revision. Keep the
      // installed rows and editable cards; refuse only reads pinned to this
      // expired positional snapshot until the user chooses to refresh it.
      expired.current = identity
      setNotice(previous => previous.identity === identity && previous.expired ? previous : { identity, expired: true })
      return true
    }
    const retryKey = JSON.stringify([report, filters, options.sort])
    if (automaticRetry.current === retryKey) {
      setState(previous => ({ ...previous, identity, ready: false, modelPending: false, error: new Error(JOURNAL_CHANGED_MESSAGE) }))
      return true
    }
    automaticRetry.current = retryKey
    recovering.current = identity
    setState(previous => ({ ...previous, ready: false, modelPending: false }))
    setGeneration(value => value + 1)
    return true
  }, [identity, report, filters, options.sort])
  const refetch = useCallback(async (refreshDispatcher = true) => {
    leafCache.current.clear()
    automaticRetry.current = ''
    expired.current = ''
    setNotice({ identity: '', expired: false })
    summaryRequest.current = null
    // A saved joint can change facet values/counts immediately. Only refresh
    // open roots; closed popups stay lazy and revision-pinned match pages are
    // replaced by their new key when the first page receives a new revision.
    const facets = { queryKey: ['weld-column-filter-options', report],
      predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[5] !== 'matches' }
    void client.cancelQueries(facets)
    void client.invalidateQueries(facets)
    if (refreshDispatcher) void client.invalidateQueries({ queryKey: ['dispatcher-task-snapshot'] }, { cancelRefetch: false })
    setGeneration(value => value + 1)
    return true
  }, [client, report])
  useEffect(() => {
    if (!options.enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribeWeldPageRefresh(client, event => {
      if (event?.reason === 'background') {
        leafCache.current.clear()
        if (installed.current !== current.current) return
        // Dispatcher and journal use independent revision counters. A changed
        // dispatcher publication is a notification, never a comparable row version.
        setNotice(previous => previous.identity === current.current ? previous : { identity: current.current, expired: false })
        return
      }
      // Coalesce the reads, but disable actions on the saved row version now.
      // Otherwise a fast second command can open a menu during the debounce
      // and lose it when the replacement block arrives.
      leafCache.current.clear()
      setState(previous => previous.ready || previous.modelPending ? { ...previous, ready: false, modelPending: false } : previous)
      clearTimeout(timer); timer = setTimeout(() => { void refetch(false) }, 80)
    })
    return () => { unsubscribe(); clearTimeout(timer) }
  }, [client, options.enabled, refetch])
  const loadSummary = useCallback(async (scope: string, version?: JournalRevision) => {
    const key = JSON.stringify([report, filters, version])
    if (summaryRequest.current?.key !== key) summaryRequest.current = {
      key, promise: getJournalReportSummary({ data: { report, ...splitReportQuickSearch(columnFilters), revision: version } }),
    }
    const pending = summaryRequest.current
    try {
      const summary = await pending.promise
      if (current.current === scope && summaryRequest.current === pending) setState(previous => previous.summary === summary && !previous.summaryError ? previous : ({ ...previous, summary, summaryError: undefined }))
    } catch (error) {
      if (current.current === scope && isJournalRevisionError(error)) recoverRevision(error)
      if (current.current === scope && summaryRequest.current === pending) setState(previous => ({ ...previous, summaryError: new Error(journalReadErrorMessage(error)) }))
    }
  }, [report, columnFilters, filters, recoverRevision])
  const loadRequests = useCallback(async (requests: Pick<JournalGridRequest, 'groupBy' | 'route' | 'start' | 'end'>[], batch: boolean, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const request = requests[0]
    const scope = identity
    const revisionScope = JSON.stringify([scope, request.groupBy])
    if (!options.enabled || scope !== current.current || recovering.current === scope) throw new DOMException('Выборка журнала обновляется.', 'AbortError')
    // Claim the grouping when the request starts, not when its reply arrives.
    // A late reply from the replaced grouping must not repin the current view.
    if (revision.current?.identity !== revisionScope) {
      leafCache.current.clear()
      revision.current = { identity: revisionScope }
      expired.current = ''
      setNotice(previous => previous.identity ? { identity: '', expired: false } : previous)
    }
    const activeRevision = revision.current
    const cacheGeneration = leafCache.current.generation
    if (expired.current === scope) throw new Error(JOURNAL_CHANGED_MESSAGE)
    try {
      const key = JSON.stringify([request.route, request.start, request.end])
      const cached = !batch && request.groupBy.length && request.route.length === request.groupBy.length
        ? leafCache.current.get(key) : undefined
      const results = cached && cached.revision === activeRevision.value ? [cached] : batch
        ? await readJournalGridBlocks({ data: { report, columnFilters, sort: options.sort, groupBy: request.groupBy,
          blocks: requests.map(({ route, start, end }) => ({ route, start, end })), revision: activeRevision.value }, signal })
        : [await readJournalGrid({ data: { ...request, report, columnFilters, sort: options.sort,
          revision: activeRevision.value }, signal })]
      const result = results[0]
      if (!result || results.length !== requests.length || results.some(value => value.revision !== result.revision)) {
        throw new Error('Не удалось получить согласованные блоки таблицы. Повторите загрузку.')
      }
      if (scope !== current.current || signal?.aborted || revision.current !== activeRevision || recovering.current === scope) throw new DOMException('Загрузка отменена: выборка изменилась.', 'AbortError')
      if (activeRevision.value !== undefined && activeRevision.value !== result.revision) throw new Error(JOURNAL_CHANGED_MESSAGE)
      activeRevision.value = result.revision
      requests.forEach((part, index) => {
        if (leafCache.current.generation === cacheGeneration && part.groupBy.length && part.route.length === part.groupBy.length) {
          leafCache.current.set(JSON.stringify([part.route, part.start, part.end]), results[index])
        }
      })
      // A successful neighbouring block must not hide an unresolved failure.
      // The response is not yet installed in AG Grid. Keep actions disabled
      // until rowsChanged publishes the committed model, including empty groups.
      setState(previous => previous.identity === scope ? previous : { rows: [], identity: scope, ready: false, modelPending: true, error: null })
      void loadSummary(scope, result.revision)
      return results
    } catch (error) {
      if (revision.current !== activeRevision || scope !== current.current || signal?.aborted || recovering.current === scope) throw new DOMException('Загрузка отменена: выборка изменилась.', 'AbortError')
      if (scope === current.current && !signal?.aborted) {
        if (recoverRevision(error)) {
          if (recovering.current === scope) throw new DOMException('Обновление версии журнала', 'AbortError')
          throw error
        }
        setState(previous => ({ ...previous, identity: scope, ready: false, error: new Error(journalReadErrorMessage(error)) }))
      }
      throw error
    }
  }, [report, identity, options.enabled, options.sort, columnFilters, filters, loadSummary, recoverRevision])
  const load = useCallback<JournalServerSource['load']>(async (request, signal) => (await loadRequests([request], false, signal))[0], [loadRequests])
  const loadBlocks = useCallback<NonNullable<JournalServerSource['loadBlocks']>>((groupBy, blocks, signal) =>
    loadRequests(blocks.map(block => ({ ...block, groupBy })), true, signal), [loadRequests])
  const rowsChanged = useCallback((rows: WeldRow[]) => {
    if (current.current !== identity || recovering.current === identity) return
    setState(previous => {
      if (previous.identity === identity && !previous.error && (previous.ready || previous.modelPending)) installed.current = identity
      return previous.identity !== identity || previous.error || !previous.ready && !previous.modelPending
      || previous.ready && previous.rows.length === rows.length && previous.rows.every((row, index) => row === rows[index])
      ? previous : { ...previous, rows, ready: true, modelPending: false }
    })
  }, [identity])
  const error = state.identity === requestedIdentity ? state.error : null
  const summaryError = state.identity === requestedIdentity ? state.summaryError : undefined
  // Only an installed, healthy replacement completes a recovery episode.
  useEffect(() => {
    if (state.identity === identity && state.ready && !state.error && recovering.current !== identity) {
      automaticRetry.current = ''; recovering.current = null
    }
  }, [identity, state.identity, state.ready, state.error])
  const updatesAvailable = notice.identity === requestedIdentity
  const revisionExpired = updatesAvailable && notice.expired
  const getSnapshot = useCallback(() => revision.current?.value === undefined ? undefined : { revision: revision.current.value, columnFilters }, [columnFilters])
  const source = useMemo<JournalServerSource>(() => ({ report, identity, getSnapshot, viewIdentity: selectionIdentity, updatesAvailable, revisionExpired, columnFilters, sort: options.sort, load, loadBlocks, rowsChanged, error, retry: () => { void refetch() }, recoverRevision }), [report, identity, getSnapshot, selectionIdentity, updatesAvailable, revisionExpired, columnFilters, options.sort, load, loadBlocks, rowsChanged, error, refetch, recoverRevision])
  const ready = options.enabled && identity === requestedIdentity && state.identity === identity && state.ready
  return {
    source, rows: ready ? state.rows : [], rowsReady: ready, requestedIdentity, selectionIdentity,
    totalCount: ready ? state.summary?.total : undefined,
    acceptedWdiTotal: ready ? state.summary?.acceptedWdiTotal : undefined,
    availableRequestCount: ready ? state.summary?.availableRequestCount : undefined,
    summaryStatus: (error || summaryError ? 'error' : ready && state.summary ? 'ready' : 'pending') as 'error' | 'ready' | 'pending',
    summaryError,
    retrySummary: () => { summaryRequest.current = null; void loadSummary(identity, revision.current?.value) },
    isFetching: !ready, isLoading: options.enabled && !ready, error, refetch,
  }
}
