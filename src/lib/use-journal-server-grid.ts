import { useEffect, useMemo, useRef, useState } from 'react'
import { writeDeferredTextToClipboard } from './clipboard'
import { flushSync } from 'react-dom'
import type { GridApi, IRowNode, IServerSideDatasource, RowGroupOpenedEvent } from 'ag-grid-community'
import { countJournalGridSelection, copyJournalGridRange, selectJournalGridRows, summarizeJournalGridRange } from '@/server/journal-grid-api'
import { FIELD_BY_KEY, type WeldFieldKey } from './weld-fields'
import type { WeldRow } from './dispatcher-types'
import { journalGroup, journalRangeParts, journalRouteKey, type JournalGridQuery, type JournalRangeRequest, type JournalRouteLayout, type JournalGridResult, type JournalRevision } from './journal-server-grid'
import type { JournalServerSource } from './use-journal-server-query'
import { EMPTY_JOURNAL_RANGE_SUMMARY } from './journal-range-summary'
import { useStableEventCallback } from './use-stable-event-callback'
import type { JournalSelectionContextValue } from '@/components/journal-server-selection'
import { createJournalCacheBudget, JOURNAL_LEAF_CACHE_BUDGET } from './journal-cache-budget'
import { readJournalLocalSelection } from './journal-local-selection'
import { journalCopyRanges } from './journal-copy-ranges'

export function useJournalServerGrid(options: {
  source?: JournalServerSource; api: GridApi<WeldRow> | null; selected: ReadonlySet<number>;
  onSelect?: (ids: Set<number>) => boolean | void; onError?: (message: string) => void; onReplace?: () => void; onReplaced?: () => void; total?: number; anchor: string; ready: boolean
}) {
  const { source, api } = options
  const current = useRef(options); current.current = options
  const installedApi = useRef<GridApi<WeldRow> | null>(null)
  const revision = useRef<JournalRevision | undefined>(undefined)
  const rootCount = useRef(0)
  const layouts = useRef(new Map<string, JournalRouteLayout>())
  const loadedRoutes = useRef<string[][]>([])
  const localMembership = useRef(new Map<string, ReadonlySet<number>>())
  // Repeated toggles of a small, unloaded group can reuse its exact response.
  // One bounded entry; a query/revision/grouping change invalidates it.
  const lastMembership = useRef<{ identity: string; revision: JournalRevision; groups: string; route: string; ids: ReadonlySet<number> } | null>(null)
  const [summary, setSummary] = useState(EMPTY_JOURNAL_RANGE_SUMMARY)
  const [rangeState, setRangeState] = useState('')
  const [copying, setCopying] = useState(false)
  const copyRequest = useRef<AbortController | null>(null)
  const [selection, setSelection] = useState<{ counts: Record<string, number>; selectedTotal: number;
    basis?: { scope: string; selected: ReadonlySet<number> } }>({ counts: {}, selectedTotal: 0 })
  const [selecting, setSelecting] = useState(false)
  const selectionRequest = useRef<AbortController | null>(null)
  const rangeRequest = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const frame = useRef(0)
  const countTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const countCache = useRef<{ scope: string; selected: ReadonlySet<number>; ids?: number[]; snapshot?: string;
    counts: Record<string, number>; total?: number; complete?: boolean } | null>(null)
  const countRequest = useRef<AbortController | null>(null)
  const rangeSignature = useRef('')
  const cacheBudget = useRef(createJournalCacheBudget())
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cachedCards = useRef(0)
  const trimCache = useStableEventCallback(() => {
    clearTimeout(cacheTimer.current)
    if (cachedCards.current <= JOURNAL_LEAF_CACHE_BUDGET) return
    cacheTimer.current = setTimeout(() => {
      const api = current.current.api
      if (api && !api.isDestroyed()) cacheBudget.current.trim(api)
    }, 180)
  })
  const query = (): JournalGridQuery => ({ report: current.current.source!.report, columnFilters: current.current.source!.columnFilters,
    sort: current.current.source!.sort, groupBy: current.current.api?.getRowGroupColumns().map(column => column.getColId() as WeldFieldKey) ?? [] })
  const reportError = (error: unknown) => current.current.onError?.(error instanceof Error ? error.message : String(error))
  const selectionScope = () => JSON.stringify([current.current.source?.identity, revision.current, query().groupBy])
  const getRange = (forCopy = false): JournalRangeRequest | null => {
    const { api, source, anchor, ready } = current.current
    if (!source || !api || api.isDestroyed() || revision.current === undefined || !ready) return null
    const ranges = (api.getCellRanges() ?? []).flatMap(range => range.startRow && range.endRow ? [{
      first: Math.min(range.startRow.rowIndex, range.endRow.rowIndex), last: Math.max(range.startRow.rowIndex, range.endRow.rowIndex),
      columns: range.columns.filter(column => column.isVisible() && FIELD_BY_KEY.has(column.getColId() as WeldFieldKey)).map(column => column.getColId() as WeldFieldKey),
    }] : [])
    if (!ranges.some(range => range.columns.length)) return null
    // An unopened store initially occupies one loading row, regardless of its
    // eventual child count. Use AG's current visual extents: after Expand All,
    // theoretical totals would shift a selected cell into a different group.
    // Read this bounded metadata only for an actual range, never per scroll.
    const stores = new Map(api.getServerSideGroupLevelState().map(store => [journalRouteKey(store.route), store]))
    const expanded = [...layouts.current.values()].map(layout => {
      const store = stores.get(journalRouteKey(layout.route))
      if (!store) throw new Error('Дождитесь загрузки раскрытых групп.')
      return { ...layout, rowCount: store.rowCount }
    })
    const count = stores.get(journalRouteKey([]))?.rowCount ?? rootCount.current
    if (count + expanded.reduce((sum, item) => sum + item.rowCount, 0) !== api.getDisplayedRowCount()) {
      throw new Error('Дождитесь загрузки раскрытых групп.')
    }
    const populated = ranges.filter(range => range.columns.length)
    const parts = journalRangeParts(forCopy ? journalCopyRanges(populated,
      api.getAllDisplayedColumns().map(column => column.getColId() as WeldFieldKey)) : populated, count, expanded)
    if (parts.some(part => !stores.get(journalRouteKey(part.route))?.lastRowIndexKnown)) {
      throw new Error('Дождитесь загрузки раскрытых групп.')
    }
    return { ...query(), revision: revision.current, anchor, parts }
  }
  const updateRange = useStableEventCallback(() => {
    if (!current.current.source) return
    let data: JournalRangeRequest | null
    try { data = getRange() } catch (error) {
      rangeSignature.current = ''
      clearTimeout(timer.current); rangeRequest.current?.abort()
      setSummary(EMPTY_JOURNAL_RANGE_SUMMARY); setRangeState((error as Error).message); return
    }
    const signature = JSON.stringify(data)
    if (rangeSignature.current === signature) return
    rangeSignature.current = signature
    clearTimeout(timer.current)
    rangeRequest.current?.abort()
    setSummary(EMPTY_JOURNAL_RANGE_SUMMARY)
    if (!data?.parts.length) { setRangeState(''); return }
    setRangeState('Считаем…')
    const request = data
    const controller = new AbortController(); rangeRequest.current = controller
    timer.current = setTimeout(() => {
      void summarizeJournalGridRange({ data: request, signal: controller.signal }).then(value => {
        if (controller.signal.aborted || rangeSignature.current !== signature) return
        setSummary(value); setRangeState('')
      }).catch(error => { if (!controller.signal.aborted) { setSummary(EMPTY_JOURNAL_RANGE_SUMMARY); setRangeState((error as Error).message) } })
    }, 150)
  })
  const updateCounts = useStableEventCallback(() => {
    clearTimeout(countTimer.current)
    countTimer.current = setTimeout(() => {
      const { api, source, selected, ready } = current.current
      if (!source || !api || api.isDestroyed() || revision.current === undefined || !ready) return
      if (!selected.size) {
        countRequest.current?.abort(); countRequest.current = null; countCache.current = null
        setSelection(previous => previous.selectedTotal === 0 && !Object.keys(previous.counts).length
          ? previous : { counts: {}, selectedTotal: 0 })
        return
      }
      const scope = selectionScope()
      if (selection.basis?.scope === scope && selection.basis.selected === selected
        && (selection.selectedTotal === 0 || selection.selectedTotal === current.current.total)) {
        // An exact all/none result applies to every group, including stores
        // opened later. Do not upload up to 200000 IDs merely to recount it.
        countRequest.current?.abort(); countRequest.current = null; countCache.current = null
        return
      }
      if (countCache.current?.scope !== scope || countCache.current.selected !== selected) {
        countRequest.current?.abort(); countRequest.current = null
        countCache.current = { scope, selected, counts: {} }
      }
      const cache = countCache.current
      if (!cache.complete && localMembership.current.has('[]')) {
        // A complete local membership already answers the exact same count
        // query, including selected IDs outside the current filters.
        const counts: Record<string, number> = {}
        for (const [route, ids] of localMembership.current) {
          let count = 0
          for (const id of ids) if (selected.has(id)) count++
          if (route === '[]') cache.total = count
          else counts[route] = count
        }
        cache.counts = counts; cache.complete = true
      }
      const routes = cache.complete ? [] : loadedRoutes.current.filter(route => !Object.hasOwn(cache.counts, journalRouteKey(route)))
      if (cache.total !== undefined && !routes.length) {
        setSelection(previous => previous.counts === cache.counts && previous.selectedTotal === cache.total
          ? previous : { counts: cache.counts, selectedTotal: cache.total!, basis: { scope, selected } })
        return
      }
      if (countRequest.current) return
      const controller = new AbortController(); countRequest.current = controller
      const data = { ...query(), revision: revision.current, routes: routes.slice(0, 256) }
      const exactIds = () => cache.ids ??= [...selected]
      const count = async () => {
        let result = await countJournalGridSelection({ signal: controller.signal, data: {
          ...data, ...(cache.snapshot ? { snapshot: cache.snapshot } : { ids: exactIds() }),
        } })
        if (result.expired && !controller.signal.aborted) result = await countJournalGridSelection({ signal: controller.signal, data: { ...data, ids: exactIds() } })
        if (controller.signal.aborted || countCache.current !== cache || current.current.selected !== cache.selected) return
        cache.counts = result.complete ? result.counts : { ...cache.counts, ...result.counts }
        cache.total = result.total; cache.snapshot = result.snapshot; cache.complete = result.complete
        countRequest.current = null
        setSelection({ counts: cache.counts, selectedTotal: result.total, basis: { scope, selected } })
        updateCounts() // At most one request; coalesce routes arriving while it was running.
      }
      void count().catch(error => {
        if (controller.signal.aborted || countCache.current !== cache) return
        countRequest.current = null
        reportError(error)
      })
    }, 80)
  })
  const modelUpdated = useStableEventCallback(() => {
    const { api, source } = current.current
    if (!source || !api || api.isDestroyed()) return
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (api.isDestroyed() || current.current.source?.identity !== source.identity) return
      const rows: WeldRow[] = []
      const nodes: IRowNode<WeldRow>[] = []
      const routes: string[][] = []
      const expanded = new Map<string, JournalRouteLayout>()
      api.forEachNode(node => {
        nodes.push(node)
        if (!node.group && node.data && !node.stub) rows.push(node.data)
        const group = journalGroup(node.data)
        if (group) routes.push(group.route)
        if (group && node.expanded) expanded.set(journalRouteKey(group.route), {
          route: group.route, ordinal: group.ordinal, rowCount: group.childCount,
        })
      })
      layouts.current = expanded
      loadedRoutes.current = routes
      localMembership.current = readJournalLocalSelection({ forEachNode: visit => nodes.forEach(visit) }, current.current.total)
      cachedCards.current = rows.length
      source.rowsChanged(rows)
      updateRange(); updateCounts()
      trimCache()
    })
  })
  useEffect(() => {
    if (!api || !source) return
    setSelecting(false)
    setCopying(false)
    const requests = new Set<AbortController>()
    rangeSignature.current = ''; countCache.current = null; countRequest.current?.abort(); countRequest.current = null; rangeRequest.current?.abort()
    setSummary(EMPTY_JOURNAL_RANGE_SUMMARY); setRangeState('')
    const identity = source.identity
    const datasource: IServerSideDatasource<WeldRow> = {
      getRows: params => {
        let settled = false
        const fail = () => { if (!settled) { settled = true; params.fail() } }
        // SSRM keeps a grid-wide request counter even after a store is destroyed.
        // Every request, including cancellation, must settle exactly once.
        if (current.current.source?.identity !== identity || api.isDestroyed()) { fail(); return }
        const controller = new AbortController(); requests.add(controller)
        const request = { groupBy: params.request.rowGroupCols.map(column => column.id as WeldFieldKey),
          route: params.request.groupKeys, start: params.request.startRow ?? 0, end: params.request.endRow ?? 100 }
        void current.current.source!.load(request, controller.signal).then(result => {
          if (controller.signal.aborted || current.current.source?.identity !== identity || api.isDestroyed()) { fail(); return }
          if (JSON.stringify(request.groupBy) !== JSON.stringify(api.getRowGroupColumns().map(column => column.getColId()))) { fail(); return }
          revision.current = result.revision
          if (!request.route.length) rootCount.current = result.rowCount
          const layout = layouts.current.get(journalRouteKey(request.route))
          if (layout) layout.rowCount = result.rowCount
          cacheBudget.current.loaded(request.route, result.rowCount)
          settled = true
          params.success({ rowData: result.rows, rowCount: result.rowCount })
          modelUpdated()
        }).catch(() => {
          fail()
          // The query source owns load errors and clears them on retry. Do not
          // also save them as persistent context-action messages in the page.
        })
          .finally(() => requests.delete(controller))
      },
      destroy: () => { requests.forEach(controller => controller.abort()); requests.clear() },
    }
    let disposed = false
    const groupBy = api.getRowGroupColumns().map(column => column.getColId() as WeldFieldKey)
    const install = (first?: JournalGridResult) => {
      if (disposed || api.isDestroyed() || current.current.source?.identity !== identity) return
      cancelAnimationFrame(frame.current); frame.current = 0
      revision.current = first?.revision; rootCount.current = first?.rowCount ?? 0; layouts.current.clear(); loadedRoutes.current = []
      localMembership.current.clear(); lastMembership.current = null
      cacheBudget.current.clear(); cachedCards.current = 0; clearTimeout(cacheTimer.current)
      api.clearCellSelection()
      const replace = () => {
        current.current.onReplace?.()
        api.setGridOption('serverSideDatasource', datasource)
        installedApi.current = api
        if (first) api.applyServerSideRowData({ successParams: { rowData: first.rows, rowCount: first.rowCount }, startRow: 0 })
      }
      if (first) {
        // The async response is outside React's lifecycle. Commit both the row
        // containers and AG's queued visible cells before the next paint. Only
        // query replacement flushes; ordinary scrolling keeps frame batching.
        flushSync(replace)
        flushSync(() => api.flushAllAnimationFrames())
        current.current.onReplaced?.()
      } else replace()
      modelUpdated()
    }
    if (installedApi.current !== api) install()
    else {
      const controller = new AbortController(); requests.add(controller)
      void source.load({ groupBy, route: [], start: 0, end: 100 }, controller.signal).then(first => {
        if (controller.signal.aborted || disposed) return
        const sameGroups = JSON.stringify(groupBy) === JSON.stringify(api.getRowGroupColumns().map(column => column.getColId()))
        install(sameGroups ? first : undefined)
      }).catch(() => { /* Load failures are exposed by the query source. */ }).finally(() => requests.delete(controller))
    }
    return () => {
      disposed = true; datasource.destroy?.(); selectionRequest.current?.abort(); selectionRequest.current = null
      copyRequest.current?.abort(); copyRequest.current = null
    }
  }, [api, source?.identity])
  useEffect(updateCounts, [options.selected, options.ready, options.total, updateCounts])
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(countTimer.current); clearTimeout(cacheTimer.current); cancelAnimationFrame(frame.current); rangeRequest.current?.abort(); countRequest.current?.abort() }, [])
  const groupOpened = (event: RowGroupOpenedEvent<WeldRow>) => {
    const group = journalGroup(event.node.data)
    if (!group) return
    const key = journalRouteKey(group.route)
    if (event.node.expanded) layouts.current.set(key, { route: group.route, ordinal: group.ordinal, rowCount: group.childCount })
    else {
      layouts.current.delete(key)
      for (const [childKey, child] of layouts.current) if (group.route.every((part, index) => child.route[index] === part)) layouts.current.delete(childKey)
    }
    updateRange()
  }
  const toggle = useStableEventCallback((row?: WeldRow) => {
    const { selected, ready } = current.current
    if (!ready || Boolean(selectionRequest.current)) return
    const group = journalGroup(row)
    const commit = (next: Set<number>, branch: readonly string[], wholeBranch: boolean, rootTotal?: number) => {
      const previous = current.current.selected, scope = selectionScope()
      // The owning report may refuse a selection (for example its existing
      // workflow limit). Never publish optimistic counters for a refused set.
      if (current.current.onSelect?.(next) === false) return
      const delta = next.size - previous.size
      const descendants: Record<string, number> = {}
      if (wholeBranch) current.current.api?.forEachNode(node => {
        const child = journalGroup(node.data)
        if (child && branch.every((part, index) => child.route[index] === part)) descendants[journalRouteKey(child.route)] = delta > 0 ? child.recordCount : 0
      })
      // The changed IDs belong to this query and branch. Update ancestors/root
      // together with leaves, but never apply a delta to stale counters.
      setSelection(value => {
        const exact = !previous.size || value.basis?.scope === scope && value.basis.selected === previous
        const empty = !previous.size || exact && value.selectedTotal === 0
        const counts = empty ? {} : { ...value.counts }
        // Once one leaf is unchecked, the uniform state ends. Materialise the
        // currently loaded group totals before applying its ancestor delta,
        // including groups that arrived after Select All.
        if (exact && !empty && value.selectedTotal === current.current.total) current.current.api?.forEachNode(node => {
          const child = journalGroup(node.data)
          if (child) counts[journalRouteKey(child.route)] = child.recordCount
        })
        if (exact) for (let depth = 1; depth <= branch.length; depth++) {
          const key = journalRouteKey(branch.slice(0, depth))
          if (empty || Object.hasOwn(counts, key)) counts[key] = (counts[key] ?? 0) + delta
        }
        return { counts: { ...counts, ...descendants },
          selectedTotal: rootTotal ?? (exact ? (previous.size ? value.selectedTotal : 0) + delta : value.selectedTotal),
          basis: exact || rootTotal !== undefined ? { scope, selected: next } : undefined }
      })
    }
    if (row && !group) {
      const next = new Set(selected); if (next.has(row.id)) next.delete(row.id); else next.add(row.id)
      const parent = current.current.api?.getRowNode(String(row.id))?.parent
      commit(next, journalGroup(parent?.data)?.route ?? [], false); return
    }
    if (revision.current === undefined) return
    const identity = current.current.source?.identity
    const selectionQuery = query()
    const route = journalRouteKey(group?.route ?? [])
    const groups = JSON.stringify(selectionQuery.groupBy)
    const cached = lastMembership.current
    if (current.current.api) localMembership.current = readJournalLocalSelection(current.current.api, current.current.total)
    const local = localMembership.current.get(route)
    // If every selected ID is in this exact, fully selected query, its existing
    // Set is also the root membership. Deselect without another ID download;
    // preserve the server path when there are selections outside the filters.
    const selectedRoot = !group && selection.basis?.scope === selectionScope() && selection.basis.selected === selected
      && selection.selectedTotal === current.current.total && selected.size === selection.selectedTotal ? selected : undefined
    const known = local ?? selectedRoot ?? (cached && cached.identity === identity && cached.revision === revision.current && cached.groups === groups && cached.route === route ? cached.ids : undefined)
    const apply = (ids: readonly number[] | ReadonlySet<number>) => {
      const previous = current.current.selected
      let remove = true
      for (const id of ids) if (!previous.has(id)) { remove = false; break }
      const next = new Set(previous)
      for (const id of ids) { if (remove) next.delete(id); else next.add(id) }
      commit(next, group?.route ?? [], true, group ? undefined : remove ? 0 : 'length' in ids ? ids.length : ids.size)
    }
    if (known) { apply(known); return }
    const controller = new AbortController(); selectionRequest.current = controller
    setSelecting(true)
    void selectJournalGridRows({ signal: controller.signal, data: { ...selectionQuery, revision: revision.current, route: group?.route ?? [] } }).then(result => {
      if (controller.signal.aborted || current.current.source?.identity !== identity || JSON.stringify(query()) !== JSON.stringify(selectionQuery)) return
      lastMembership.current = identity && result.ids.length <= JOURNAL_LEAF_CACHE_BUDGET
        ? { identity, revision: result.revision, groups, route, ids: new Set(result.ids) } : null
      apply(result.ids)
    }).catch(error => { if (!controller.signal.aborted) reportError(error) }).finally(() => {
      if (selectionRequest.current !== controller) return
      selectionRequest.current = null
      setSelecting(false); updateCounts()
    })
  })
  const copy = useStableEventCallback(() => {
    let data: JournalRangeRequest | null
    try { data = getRange(true) } catch (error) { reportError(error); return }
    if (!data?.parts.length) return
    if (copyRequest.current) return
    const controller = new AbortController(); copyRequest.current = controller
    setCopying(true)
    const identity = current.current.source?.identity
    const text = copyJournalGridRange({ data, signal: controller.signal }).then(value => {
      controller.signal.throwIfAborted()
      if (current.current.source?.identity !== identity || JSON.stringify(getRange(true)) !== JSON.stringify(data)) throw new Error('Выборка или диапазон изменились. Повторите копирование.')
      return value
    })
    const write = writeDeferredTextToClipboard(text)
    void write.catch(error => {
      if (!controller.signal.aborted) {
        // Permission can fail before the deferred item is ready. Stop the
        // potentially large server copy instead of computing unused output.
        controller.abort(); reportError(error)
      }
    }).finally(() => {
      if (copyRequest.current !== controller) return
      copyRequest.current = null; setCopying(false)
    })
  })
  const selectionContext = useMemo<JournalSelectionContextValue | null>(() => {
    if (!source) return null
    const known = new Map(localMembership.current)
    const cached = lastMembership.current
    if (cached && cached.identity === source.identity && cached.revision === revision.current
      && cached.groups === JSON.stringify(api?.getRowGroupColumns().map(column => column.getColId()) ?? [])) known.set(cached.route, cached.ids)
    const counts = options.selected.size ? { ...selection.counts } : {}
    let selectedTotal = options.selected.size ? selection.selectedTotal : 0
    let rootExact = !options.selected.size || selection.basis?.scope === selectionScope() && selection.basis.selected === options.selected
    for (const [route, ids] of known) {
      let count = 0
      for (const id of ids) if (options.selected.has(id)) count++
      if (route === '[]') { selectedTotal = count; rootExact = true }
      else counts[route] = count
    }
    const uniform = rootExact && selectedTotal === 0 ? false
      : rootExact && options.total !== undefined && selectedTotal === options.total ? true : undefined
    return { ids: options.selected, counts, selectedTotal, uniform,
      // Background counters must not swallow the next key or checkbox click.
      pending: selecting || !options.ready, toggle }
  }, [source?.identity, api, options.selected, selection, selecting, options.total, options.ready, toggle])
  return { summary, rangeState: copying ? 'Копируем…' : rangeState, updateRange, modelUpdated, groupOpened, copy, selectionContext, trimCache,
    resetLayout: () => {
      copyRequest.current?.abort(); copyRequest.current = null; setCopying(false)
      selectionRequest.current?.abort(); selectionRequest.current = null; setSelecting(false)
      lastMembership.current = null; localMembership.current.clear(); api?.clearCellSelection()
      cacheBudget.current.clear(); cachedCards.current = 0; clearTimeout(cacheTimer.current)
      rootCount.current = 0; layouts.current.clear(); loadedRoutes.current = []; rangeSignature.current = ''
      countCache.current = null; countRequest.current?.abort(); countRequest.current = null
      updateRange()
    },
    getRowId: (row: WeldRow) => journalGroup(row) ? `group:${journalRouteKey(journalGroup(row)!.route)}` : String(row.id),
  }
}
