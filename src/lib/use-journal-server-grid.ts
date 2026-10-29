import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { writeDeferredTextToClipboard } from './clipboard'
import { flushSync } from 'react-dom'
import type { GridApi, IRowNode, IServerSideDatasource, RowGroupOpenedEvent } from 'ag-grid-community'
import { countJournalGridSelection, copyJournalGridRange, selectJournalGridRange, selectJournalGridRows, summarizeJournalGridRange } from '@/server/journal-grid-api'
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
import type { JournalSummaryRange } from './journal-selection-summary'
import { journalReadErrorMessage, JOURNAL_CHANGED_MESSAGE } from './journal-read-error'
import { collectJournalRefreshBlocks, journalBlockKey, journalRefreshBlocksUnchanged, planJournalBlockRefresh, type JournalRefreshBlock } from './journal-refresh-blocks'

export function useJournalServerGrid(options: {
  source?: JournalServerSource; api: GridApi<WeldRow> | null; selected: ReadonlySet<number>;
  onSelect?: (ids: Set<number>) => boolean | void; onError?: (message: string) => void; onReplace?: (preservePosition: boolean) => void; onReplaced?: () => void; total?: number; anchor: string; ready: boolean
}) {
  const { source, api } = options
  const current = useRef(options); current.current = options
  const installedApi = useRef<GridApi<WeldRow> | null>(null)
  const installedIdentity = useRef('')
  const installedView = useRef<string | undefined>(undefined)
  // The grid keeps one datasource while the query is unchanged. Each refresh
  // delegates to a new, cancellable revision without destroying row nodes.
  const datasourceDelegate = useRef<IServerSideDatasource<WeldRow> | null>(null)
  const refreshingStores = useRef<Set<string> | null>(null)
  const expandedOnRefresh = useRef(new Set<string>())
  const positionOnRefresh = useRef<{ y: number; row: number; id?: string; column?: string } | null>(null)
  const isRestoring = useCallback(() => Boolean(positionOnRefresh.current), [])
  useEffect(() => {
    const cancel = (event: Event) => {
      if (!positionOnRefresh.current || event.target instanceof Element && event.target.closest('[role="dialog"], input, textarea, select, [contenteditable="true"]')) return
      if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return
      positionOnRefresh.current = null; expandedOnRefresh.current.clear()
    }
    window.addEventListener('wheel', cancel, { capture: true, passive: true })
    window.addEventListener('touchstart', cancel, { capture: true, passive: true })
    window.addEventListener('keydown', cancel, true)
    return () => {
      window.removeEventListener('wheel', cancel, true); window.removeEventListener('touchstart', cancel, true); window.removeEventListener('keydown', cancel, true)
    }
  }, [])
  const activeLoads = useRef(new Map<AbortController, string>())
  const revision = useRef<JournalRevision | undefined>(undefined)
  const revisionGroups = useRef<string | null>(null)
  const [groupingReady, setGroupingReady] = useState(false)
  const rootCount = useRef(0)
  const layouts = useRef(new Map<string, JournalRouteLayout>())
  const loadedRoutes = useRef<string[][]>([])
  const localMembership = useRef(new Map<string, ReadonlySet<number>>())
  // Repeated toggles of a small, unloaded group can reuse its exact response.
  // One bounded entry; a query/revision/grouping change invalidates it.
  const lastMembership = useRef<{ identity: string; revision: JournalRevision; groups: string; route: string; ids: ReadonlySet<number> } | null>(null)
  const [summary, setSummary] = useState(EMPTY_JOURNAL_RANGE_SUMMARY)
  const [rangeState, setRangeState] = useState('')
  const [summaryRange, setSummaryRange] = useState<JournalSummaryRange>(null)
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
  const reportError = (error: unknown) => {
    current.current.source?.recoverRevision?.(error)
    current.current.onError?.(journalReadErrorMessage(error))
  }
  const selectionScope = () => JSON.stringify([current.current.source?.identity, revision.current, query().groupBy])
  const getRange = (mode: 'summary' | 'copy' | 'selection' = 'summary'): JournalRangeRequest | null => {
    const { api, source, anchor, ready } = current.current
    if (!source || !api || api.isDestroyed() || revision.current === undefined || !ready) return null
    if (source.revisionExpired) throw new Error(JOURNAL_CHANGED_MESSAGE)
    const ranges = (api.getCellRanges() ?? []).flatMap(range => range.startRow && range.endRow ? [{
      first: Math.min(range.startRow.rowIndex, range.endRow.rowIndex), last: Math.max(range.startRow.rowIndex, range.endRow.rowIndex),
      columns: mode === 'selection' ? ['id' as const]
        : range.columns.filter(column => column.isVisible() && FIELD_BY_KEY.has(column.getColId() as WeldFieldKey)).map(column => column.getColId() as WeldFieldKey),
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
    const parts = journalRangeParts(mode === 'copy' ? journalCopyRanges(populated,
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
      const message = journalReadErrorMessage(error)
      setSummaryRange(previous => previous?.error === message ? previous : { request: null, error: message })
      setSummary(EMPTY_JOURNAL_RANGE_SUMMARY); setRangeState(message); return
    }
    // Physical totals depend on row membership, not how many columns are marked.
    const nextRange: JournalSummaryRange = data?.parts.length ? { request: { ...data,
      parts: data.parts.map(part => ({ ...part, columns: ['id'] })),
    } } : null
    setSummaryRange(previous => JSON.stringify(previous) === JSON.stringify(nextRange) ? previous : nextRange)
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
      }).catch(error => {
        if (controller.signal.aborted || rangeSignature.current !== signature || !current.current.ready) return
        if (current.current.source?.recoverRevision?.(error)) return
        setSummary(EMPTY_JOURNAL_RANGE_SUMMARY); setRangeState(journalReadErrorMessage(error))
      })
    }, 150)
  })
  const updateCounts = useStableEventCallback(() => {
    clearTimeout(countTimer.current)
    if (!current.current.ready || current.current.source?.revisionExpired) {
      countRequest.current?.abort(); countRequest.current = null; countCache.current = null
      return
    }
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
        if (controller.signal.aborted || countCache.current !== cache || !current.current.ready || selectionScope() !== scope) return
        countRequest.current = null
        if (current.current.source?.recoverRevision?.(error)) return
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
      if (api.isDestroyed() || current.current.source?.identity !== source.identity || installedIdentity.current !== source.identity) return
      const refreshed = Boolean(refreshingStores.current)
      if (refreshingStores.current) {
        const existing = new Set(api.getServerSideGroupLevelState().map(store => journalRouteKey(store.route)))
        for (const key of refreshingStores.current) if (!existing.has(key)) refreshingStores.current.delete(key)
        // No action or summary may treat a partly refreshed cache as a single
        // revision. Deleted groups need no completion event from their old store.
        if (refreshingStores.current.size || activeLoads.current.size) return
        refreshingStores.current = null
      }
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
      // Group cells compare their unchanged group key. Their totals/statuses
      // still need a renderer refresh when the retained node receives new data.
      if (refreshed) api.refreshCells({ rowNodes: nodes.filter(node => node.group), force: true })
      layouts.current = expanded
      loadedRoutes.current = routes
      localMembership.current = readJournalLocalSelection({ forEachNode: visit => nodes.forEach(visit) }, current.current.total)
      cachedCards.current = rows.length
      source.rowsChanged(rows)
      // Restore through the public expansion API after nodes exist. SSRM can
      // retain a previously cached default (collapsed) across datasource swaps.
      let restored = false
      for (const node of nodes) {
        if (!node.group || !node.id || !expandedOnRefresh.current.has(node.id)) continue
        expandedOnRefresh.current.delete(node.id)
        // Discard a retained child store before reopening it against the new
        // datasource (purgeClosedRowNodes is enabled on this grid).
        if (node.expanded) api.setRowNodeExpanded(node, false, false, true)
        api.setRowNodeExpanded(node, true, false, true)
        restored = true
      }
      if (restored) { modelUpdated(); return }
      const position = positionOnRefresh.current
      if (position) {
        const node = position.id ? api.getRowNode(position.id) : undefined
        // Restore only once the ancestor stores have materialised. Deleted or
        // filtered-out anchors fall back to the previous bounded row position.
        const stores = api.getServerSideGroupLevelState()
        const pending = nodes.find(node => {
          const group = journalGroup(node.data)
          return node.group && node.expanded && group &&
            !stores.find(store => journalRouteKey(store.route) === journalRouteKey(group.route))?.lastRowIndexKnown
        })
        // SSRM loads only visible blocks. After replacing a long grouped view,
        // its viewport may sit below the reopened group's single loading row.
        // Bring that row into view so the ancestor store can actually load.
        if (pending?.rowIndex != null) api.ensureIndexVisible(pending.rowIndex + 1, 'top')
        if (!pending) {
          const index = Math.max(0, Math.min(node?.rowIndex ?? position.row, api.getDisplayedRowCount() - 1))
          if (api.getDisplayedRowCount()) api.ensureIndexVisible(index)
          const target = api.getDisplayedRowAtIndex(index)
          if (!api.getDisplayedRowCount() || target?.data && !target.stub) requestAnimationFrame(() => {
            if (api.isDestroyed() || positionOnRefresh.current !== position) return
            // The document track needs its layout frame after children arrive.
            window.scrollTo({ top: position.y, behavior: 'instant' })
            positionOnRefresh.current = null
            const active = document.activeElement
            // A user may already have opened a header menu or another control
            // while this block was loading. Do not steal that newer focus.
            const gridOwnsFocus = active === document.body || active instanceof Element && Boolean(active.closest('.ag-cell'))
            const overlayOpen = document.querySelector('[role="dialog"], [data-workflow-menu], [role="menu"], .ag-menu')
            if (target?.rowIndex != null && position.column && gridOwnsFocus && !overlayOpen) api.setFocusedCell(target.rowIndex, position.column)
          })
        }
      }
      updateRange(); updateCounts()
      trimCache()
    })
  })
  const storeRefreshed = useStableEventCallback((event: { route?: string[] }) => {
    refreshingStores.current?.delete(journalRouteKey(event.route ?? []))
    modelUpdated()
  })
  useEffect(() => {
    if (!api || !source) return
    setSelecting(false)
    setCopying(false)
    const requests = new Map<AbortController, string>(); activeLoads.current = requests
    clearTimeout(timer.current); clearTimeout(countTimer.current)
    rangeSignature.current = ''; countCache.current = null; countRequest.current?.abort(); countRequest.current = null; rangeRequest.current?.abort()
    setSummary(EMPTY_JOURNAL_RANGE_SUMMARY); setRangeState(''); setSummaryRange(null)
    const identity = source.identity
    const preservePosition = installedApi.current === api && source.viewIdentity !== undefined && installedView.current === source.viewIdentity
    expandedOnRefresh.current = new Set()
    positionOnRefresh.current = null
    let prepared: JournalGridResult | undefined
    const preparedBlocks = new Map<string, JournalGridResult>()
    const datasource: IServerSideDatasource<WeldRow> = {
      getRows: params => {
        let settled = false
        const fail = () => { if (!settled) { settled = true; params.fail() } }
        // SSRM keeps a grid-wide request counter even after a store is destroyed.
        // Every request, including cancellation, must settle exactly once.
        if (current.current.source?.identity !== identity || api.isDestroyed()) { fail(); return }
        const request = { groupBy: params.request.rowGroupCols.map(column => column.id as WeldFieldKey),
          route: params.request.groupKeys, start: params.request.startRow ?? 0, end: params.request.endRow ?? 100 }
        const groups = JSON.stringify(request.groupBy)
        if (groups !== JSON.stringify(api.getRowGroupColumns().map(column => column.getColId()))) { fail(); return }
        if (groups !== JSON.stringify(groupBy)) { prepared = undefined; preparedBlocks.clear() }
        const controller = new AbortController(); requests.set(controller, groups)
        const blockKey = journalBlockKey(request)
        const cached = groups === JSON.stringify(groupBy) ? preparedBlocks.get(blockKey) ??
          (prepared && !request.route.length && request.start === 0 && request.end === 100 ? prepared : undefined) : undefined
        if (cached) { preparedBlocks.delete(blockKey); if (!request.route.length && request.start === 0) prepared = undefined }
        void (cached ? Promise.resolve(cached) : current.current.source!.load(request, controller.signal)).then(result => {
          if (controller.signal.aborted || current.current.source?.identity !== identity || api.isDestroyed()) { fail(); return }
          if (JSON.stringify(request.groupBy) !== JSON.stringify(api.getRowGroupColumns().map(column => column.getColId()))) { fail(); return }
          revision.current = result.revision
          revisionGroups.current = groups
          setGroupingReady(true)
          if (!request.route.length) rootCount.current = result.rowCount
          const layout = layouts.current.get(journalRouteKey(request.route))
          if (layout) layout.rowCount = result.rowCount
          cacheBudget.current.loaded(request.route, result.rowCount)
          settled = true
          params.success({ rowData: result.rows, rowCount: result.rowCount })
          modelUpdated()
        }).catch(() => {
          if (current.current.source?.identity === identity) { positionOnRefresh.current = null; expandedOnRefresh.current.clear() }
          fail()
          // The query source owns load errors and clears them on retry. Do not
          // also save them as persistent context-action messages in the page.
        })
          .finally(() => { requests.delete(controller); modelUpdated() })
      },
      destroy: () => { requests.forEach((_groups, controller) => controller.abort()); requests.clear() },
    }
    let disposed = false
    const groupBy = api.getRowGroupColumns().map(column => column.getColId() as WeldFieldKey)
    const install = (first?: JournalGridResult, snapshot?: { blocks: JournalRefreshBlock[]; results: JournalGridResult[] }) => {
      if (disposed || api.isDestroyed() || current.current.source?.identity !== identity) return
      cancelAnimationFrame(frame.current); frame.current = 0
      revision.current = first?.revision; revisionGroups.current = first ? JSON.stringify(groupBy) : null
      setGroupingReady(Boolean(first))
      const stores = preservePosition && first ? api.getServerSideGroupLevelState() : []
      const populated = new Set<string>()
      if (stores.length) api.forEachNode(node => { if (node.data && !node.stub) populated.add(journalRouteKey(node.parent?.getRoute() ?? [])) })
      // Empty/unloaded child caches and interrupted refreshes take the existing
      // replacement path: their old extents cannot be declared current.
      const smooth = preservePosition && Boolean(first) && !refreshingStores.current &&
        stores.length > 0 && stores.every(store => populated.has(journalRouteKey(store.route)))
      refreshingStores.current = null
      rootCount.current = first?.rowCount ?? 0; layouts.current.clear(); loadedRoutes.current = []
      localMembership.current.clear(); lastMembership.current = null
      cacheBudget.current.clear(); cachedCards.current = 0; clearTimeout(cacheTimer.current)
      if (preservePosition && !smooth) {
        api.forEachNode(node => { if (node.group && node.expanded && node.id) expandedOnRefresh.current.add(node.id) })
        const cell = api.getFocusedCell(), node = cell ? api.getDisplayedRowAtIndex(cell.rowIndex) : undefined
        positionOnRefresh.current = { y: window.scrollY, row: cell?.rowIndex ?? api.getFirstDisplayedRowIndex(), id: node?.id, column: cell?.column.getColId() }
      } else positionOnRefresh.current = null
      api.clearCellSelection()
      const replace = () => {
        current.current.onReplace?.(preservePosition)
        datasourceDelegate.current = datasource
        if (smooth) {
          prepared = first
          const patch = snapshot && journalRefreshBlocksUnchanged(snapshot.blocks, collectJournalRefreshBlocks(api))
            ? planJournalBlockRefresh(snapshot.blocks, snapshot.results) : undefined
          refreshingStores.current = new Set()
          if (patch) {
            for (const block of snapshot!.blocks) cacheBudget.current.loaded(block.route, block.rowCount)
            for (const plan of patch) {
              if (!plan.refresh && plan.update.length) {
                const result = api.applyServerSideTransaction({ route: plan.route, update: plan.update })
                if (result?.status !== 'Applied') plan.refresh = true
              }
              if (plan.refresh) refreshingStores.current.add(journalRouteKey(plan.route))
            }
            // Changed membership/order uses AG's non-purging block replacement.
            // Reuse the same server snapshot; unchanged stores need no reload.
            snapshot!.blocks.forEach((block, i) => {
              if (refreshingStores.current!.has(journalRouteKey(block.route))) preparedBlocks.set(journalBlockKey(block), snapshot!.results[i])
            })
          } else for (const store of stores) refreshingStores.current.add(journalRouteKey(store.route))
          for (const store of stores) if (refreshingStores.current.has(journalRouteKey(store.route))) api.refreshServerSide({ route: store.route, purge: false })
          if (!refreshingStores.current.has('[]')) prepared = undefined
        } else {
          api.setGridOption('serverSideDatasource', {
            getRows: params => datasourceDelegate.current?.getRows(params),
          } satisfies IServerSideDatasource<WeldRow>)
        }
        installedApi.current = api
        installedIdentity.current = source.identity
        installedView.current = source.viewIdentity
        if (first && !smooth) api.applyServerSideRowData({ successParams: { rowData: first.rows, rowCount: first.rowCount }, startRow: 0 })
      }
      if (first) {
        // The async response is outside React's lifecycle. Commit both the row
        // containers and AG's queued visible cells before the next paint. Only
        // query replacement flushes; ordinary scrolling keeps frame batching.
        flushSync(replace)
        flushSync(() => api.flushAllAnimationFrames())
        if (!smooth) current.current.onReplaced?.()
      } else replace()
      modelUpdated()
    }
    if (installedApi.current !== api) install()
    else {
      const controller = new AbortController(); requests.set(controller, JSON.stringify(groupBy))
      const blocks = preservePosition && !refreshingStores.current && source.loadBlocks ? collectJournalRefreshBlocks(api) : null
      const prefetch = async () => {
        if (!blocks || !source.loadBlocks) return { first: await source.load({ groupBy, route: [], start: 0, end: 100 }, controller.signal) }
        const root = { route: [], start: 0, end: 100 }
        const rootIndex = blocks.findIndex(block => journalBlockKey(block) === journalBlockKey(root))
        const requests = rootIndex < 0 ? [root, ...blocks] : blocks
        const results: JournalGridResult[] = []
        for (let index = 0; index < requests.length; index += 32) {
          results.push(...await source.loadBlocks(groupBy, requests.slice(index, index + 32), controller.signal))
        }
        return { first: results[rootIndex < 0 ? 0 : rootIndex], snapshot: { blocks, results: rootIndex < 0 ? results.slice(1) : results } }
      }
      void prefetch().then(({ first, snapshot }) => {
        if (controller.signal.aborted || disposed) return
        const sameGroups = JSON.stringify(groupBy) === JSON.stringify(api.getRowGroupColumns().map(column => column.getColId()))
        install(sameGroups ? first : undefined, sameGroups ? snapshot : undefined)
      }).catch(() => {
        // Regrouping cancels the old prefetch. Install the current delegate so
        // the replacement grouping can load; otherwise the retained datasource
        // still belongs to the previous generation and rejects every request.
        if (!disposed && !api.isDestroyed() && current.current.source?.identity === identity &&
          JSON.stringify(groupBy) !== JSON.stringify(api.getRowGroupColumns().map(column => column.getColId()))) install()
        // Ordinary load failures remain owned by the query source.
      }).finally(() => { requests.delete(controller); modelUpdated() })
    }
    return () => {
      disposed = true; datasource.destroy?.(); selectionRequest.current?.abort(); selectionRequest.current = null
      copyRequest.current?.abort(); copyRequest.current = null
    }
  }, [api, source?.identity])
  useEffect(updateCounts, [options.selected, options.ready, options.total, source?.revisionExpired, updateCounts])
  useEffect(updateRange, [options.ready, source?.revisionExpired, updateRange])
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
    if (current.current.source?.revisionExpired) { reportError(new Error(JOURNAL_CHANGED_MESSAGE)); return }
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
  const selectRange = useStableEventCallback(() => {
    if (selectionRequest.current) return
    let data: JournalRangeRequest | null
    try { data = getRange('selection') } catch (error) { reportError(error); return }
    if (!data?.parts.length) return
    const controller = new AbortController(); selectionRequest.current = controller
    const selected = current.current.selected, identity = current.current.source?.identity
    const signature = JSON.stringify(data)
    setSelecting(true)
    void selectJournalGridRange({ data, signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return
      // Never apply a positional result to a changed range/query or resurrect
      // selection cleared while the request was in flight.
      if (current.current.source?.identity !== identity || current.current.selected !== selected
        || JSON.stringify(getRange('selection')) !== signature) {
        throw new Error('Выборка или выделение изменились. Повторите Shift+Пробел.')
      }
      const remove = result.ids.length > 0 && result.ids.every(id => selected.has(id))
      const next = new Set(selected)
      for (const id of result.ids) { if (remove) next.delete(id); else next.add(id) }
      if (next.size !== selected.size) current.current.onSelect?.(next)
    }).catch(error => { if (!controller.signal.aborted) reportError(error) }).finally(() => {
      if (selectionRequest.current !== controller) return
      selectionRequest.current = null; setSelecting(false); updateCounts()
    })
  })
  const copy = useStableEventCallback(() => {
    let data: JournalRangeRequest | null
    try { data = getRange('copy') } catch (error) { reportError(error); return }
    if (!data?.parts.length) return
    if (copyRequest.current) return
    const controller = new AbortController(); copyRequest.current = controller
    setCopying(true)
    const identity = current.current.source?.identity
    const text = copyJournalGridRange({ data, signal: controller.signal }).then(value => {
      controller.signal.throwIfAborted()
      if (current.current.source?.identity !== identity || JSON.stringify(getRange('copy')) !== JSON.stringify(data)) throw new Error('Выборка или диапазон изменились. Повторите копирование.')
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
      pending: selecting || !options.ready || !groupingReady, toggle }
  }, [source?.identity, api, options.selected, selection, selecting, options.total, options.ready, groupingReady, toggle])
  return { summary, summaryRange, rangeState: copying ? 'Копируем…' : rangeState, updateRange, modelUpdated, storeRefreshed, groupOpened, copy, selectRange, selectionContext, trimCache, isRestoring,
    resetLayout: () => {
      const groups = JSON.stringify(api?.getRowGroupColumns().map(column => column.getColId()) ?? [])
      for (const [controller, requestedGroups] of activeLoads.current) if (requestedGroups !== groups) controller.abort()
      // AG can repeat this event after installing the same grouping's rows.
      // Keep that committed revision; only a genuinely different layout expires it.
      if (revisionGroups.current !== groups) { refreshingStores.current = null; revision.current = undefined; setGroupingReady(false) }
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
