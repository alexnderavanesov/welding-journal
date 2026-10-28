import { useEffect, useMemo, useRef, useState } from 'react'
import type { GridApi, IRowNode } from 'ag-grid-community'
import { isDocumentHistoryGroupRow, type DocumentHistoryGridRequest, type DocumentHistoryGridResult, type DocumentHistoryGroupRow } from './document-history-grid'
import { journalRangeParts, journalRouteKey, type JournalRangePart, type JournalRouteLayout } from './journal-server-grid'
import { journalCopyRanges } from './journal-copy-ranges'
import { mergeJournalRangeSpans, journalRangeSummaryChunks, EMPTY_JOURNAL_RANGE_SUMMARY } from './journal-range-summary'
import { gridClipboardNumber } from './grid-clipboard-number'
import { writeDeferredTextToClipboard } from './clipboard'
import { useStableEventCallback } from './use-stable-event-callback'
import { createJournalCacheBudget } from './journal-cache-budget'

type Id = string | number
type Identity = { id: Id }
export function useDocumentGridQuery<T extends Identity>(options: {
  api: GridApi<T | DocumentHistoryGroupRow> | null; scope: string; ready: boolean; total: number
  selected: readonly Identity[]; select: (rows: Identity[]) => void
  load: (request: DocumentHistoryGridRequest) => Promise<DocumentHistoryGridResult<T>>
  search: string; columns: readonly { key: string; label: string }[]
  value: (key: string, row: T) => string | number; error: (message: string) => void
}) {
  const current = useRef(options); current.current = options
  const selectedIds = useMemo(() => new Set(options.selected.map(row => row.id)), [options.selected])
  const revision = useRef<string | undefined>(undefined)
  const generation = useRef(0), copyGeneration = useRef(0), rangeGeneration = useRef(0), countGeneration = useRef(0)
  const selectedIdentity = useRef(options.selected), selectionVersion = useRef(0), selectionBusy = useRef<number | null>(null)
  if (selectedIdentity.current !== options.selected) { selectedIdentity.current = options.selected; selectionVersion.current++ }
  const [selecting, setSelecting] = useState(false), [copying, setCopying] = useState(false)
  const [summary, setSummary] = useState(EMPTY_JOURNAL_RANGE_SUMMARY), [rangeState, setRangeState] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const countTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const countQuery = useRef<{ key: string; promise: Promise<DocumentHistoryGridResult<T>> } | null>(null)
  const rangeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const membership = useRef(new Map<string, Id[]>())
  const membershipCounts = useRef(new WeakMap<Id[], { version: number; count: number }>())
  const countMembers = (ids: Id[]) => {
    const cached = membershipCounts.current.get(ids)
    if (cached?.version === selectionVersion.current) return cached.count
    const count = ids.reduce<number>((sum, id) => sum + Number(selectedIds.has(id)), 0)
    membershipCounts.current.set(ids, { version: selectionVersion.current, count })
    return count
  }
  const lastRanges = useRef('')
  const copyingRanges = useRef<string | null>(null)
  const visualSignature = () => JSON.stringify((current.current.api?.getCellRanges() ?? []).map(range => [
    range.startRow?.rowIndex, range.endRow?.rowIndex, range.columns.map(column => column.getColId()),
  ]))
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const budget = useRef(createJournalCacheBudget<T | DocumentHistoryGroupRow>(2000, node => isDocumentHistoryGroupRow(node.data) ? routeOf(node) : undefined))
  const query = (): DocumentHistoryGridRequest => {
    const columns = current.current.api?.getColumnState() ?? []
    return { startRow: 0, endRow: 100, groupKeys: [], search: current.current.search, revision: revision.current,
      rowGroupCols: columns.filter(column => column.rowGroup).sort((a, b) => (a.rowGroupIndex ?? 0) - (b.rowGroupIndex ?? 0)).map(column => column.colId),
      sortModel: columns.filter(column => column.sort).sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0)).map(column => ({ colId: column.colId, sort: column.sort! })) }
  }
  const routeOf = (node: IRowNode<T | DocumentHistoryGroupRow>) => {
    const route: string[] = []
    for (let item: typeof node | null = node; item && item.level >= 0; item = item.parent) if (item.group && isDocumentHistoryGroupRow(item.data)) route.unshift(item.data.groupKey)
    return route
  }
  const accept = useStableEventCallback((result: DocumentHistoryGridResult<T>, route: string[] = []) => {
    revision.current = result.revision; budget.current.loaded(route, result.rowCount)
  })
  const trim = useStableEventCallback(() => {
    clearTimeout(cacheTimer.current)
    cacheTimer.current = setTimeout(() => { const api = current.current.api; if (api && !api.isDestroyed()) budget.current.trim(api) }, 180)
  })
  const invalidate = useStableEventCallback(() => {
    generation.current++; copyGeneration.current++; rangeGeneration.current++; countGeneration.current++
    revision.current = undefined; membership.current.clear(); budget.current.clear(); lastRanges.current = ''; copyingRanges.current = null
    countQuery.current = null
    clearTimeout(countTimer.current); clearTimeout(rangeTimer.current); clearTimeout(cacheTimer.current)
    setSelecting(false); setCopying(false); setSummary(EMPTY_JOURNAL_RANGE_SUMMARY); setRangeState(''); setCounts({})
  })
  useEffect(() => { invalidate(); return () => { generation.current++; copyGeneration.current++; rangeGeneration.current++; countGeneration.current++; clearTimeout(countTimer.current); clearTimeout(rangeTimer.current); clearTimeout(cacheTimer.current) } }, [options.scope, invalidate])
  const countSelection = useStableEventCallback(() => {
    clearTimeout(countTimer.current)
    const requestId = ++countGeneration.current
    countTimer.current = setTimeout(() => {
      const { api, selected, ready, load } = current.current
      if (!api || api.isDestroyed() || !ready || !revision.current) return
      const selectedSet = selectedIds, routes = new Map<string, string[]>([['[]', []]])
      const sizes: Record<string, number> = { '[]': current.current.total }
      const selectedRoutes = new Map<Id, string[]>()
      api.forEachNode(node => { if (node.group && isDocumentHistoryGroupRow(node.data)) {
        const route = routeOf(node), key = journalRouteKey(route); routes.set(key, route); sizes[key] = node.data.childCount
      } else if (node.data && !isDocumentHistoryGroupRow(node.data) && selectedSet.has(node.data.id)) selectedRoutes.set(node.data.id, routeOf(node)) })
      // Every selected identity is present in this filtered cache: membership
      // is exact, even though the rest of the registry has not been loaded.
      if (selectedRoutes.size === selectedSet.size) {
        setCounts(Object.fromEntries([...routes].map(([key, route]) => [key,
          [...selectedRoutes.values()].filter(leaf => route.every((part, index) => leaf[index] === part)).length])))
        return
      }
      const rootIds = membership.current.get('[]')
      const rootSelected = rootIds ? countMembers(rootIds) : undefined
      if (rootIds && (rootSelected === 0 || rootSelected === rootIds.length)) {
        setCounts(Object.fromEntries([...routes.keys()].map(key => [key, rootSelected ? sizes[key] : 0])))
        return
      }
      const local: Record<string, number> = {}, missing: string[][] = []
      for (const [key, route] of routes) {
        const ids = membership.current.get(key)
        if (!selected.length) local[key] = 0
        else if (ids) local[key] = countMembers(ids)
        else missing.push(route)
      }
      if (!missing.length) { setCounts(local); return }
      const request = query()
      void (async () => {
        for (let start = 0; start < missing.length; start += 256) {
          const data: DocumentHistoryGridRequest = { ...request, countRoutes: missing.slice(start, start + 256), selectedIds: [...selectedSet], cells: { columns: ['title'], summary: true } }
          // Restoring/laying out stores can emit several model updates for the
          // same groups. Share one in-flight or successful count for this exact
          // revision and selection; retain at most one bounded batch.
          const key = JSON.stringify([generation.current, data])
          if (countQuery.current?.key !== key) {
            const entry = { key, promise: load(data) }
            countQuery.current = entry
            void entry.promise.catch(() => { if (countQuery.current === entry) countQuery.current = null })
          }
          const result = await countQuery.current.promise
          if (requestId !== countGeneration.current) return
          Object.assign(local, result.counts)
        }
        setCounts(local)
      })().catch(error => { if (requestId === countGeneration.current) current.current.error(error.message) })
    }, 80)
  })
  useEffect(countSelection, [options.selected, options.ready, countSelection])
  const toggle = useStableEventCallback(async (node?: IRowNode<T | DocumentHistoryGroupRow>) => {
    const { ready, api, load } = current.current
    if (!ready || !api || api.isDestroyed() || selectionBusy.current === generation.current || !revision.current) return
    const route = node ? routeOf(node) : [], key = journalRouteKey(route), active = generation.current, choice = selectionVersion.current
    let ids = membership.current.get(key)
    // A completely loaded group can be selected synchronously; unknown membership uses one ID query.
    if (!ids) {
      const loaded: Id[] = []
      api.forEachNode(item => { if (item.data && !item.group && !isDocumentHistoryGroupRow(item.data)
        && (!node || route.every((part, index) => routeOf(item)[index] === part))) loaded.push(item.data.id) })
      const expected = node && isDocumentHistoryGroupRow(node.data) ? node.data.childCount : current.current.total
      if (new Set(loaded).size === expected) ids = loaded
    }
    if (!ids) {
      selectionBusy.current = active; setSelecting(true)
      try {
        const result = await load({ ...query(), groupKeys: route, idsOnly: true })
        if (active !== generation.current || choice !== selectionVersion.current) return
        ids = result.ids ?? []
      } catch (error) { if (active === generation.current) current.current.error((error as Error).message); return }
      finally { if (selectionBusy.current === active) selectionBusy.current = null; if (active === generation.current) setSelecting(false) }
    }
    membership.current.set(key, ids)
    // Keep one full membership and bounded smaller groups, not copies of the entire registry at every level.
    while (membership.current.size > 16) membership.current.delete(membership.current.keys().next().value!)
    const selected = new Set(current.current.selected.map(row => row.id)), remove = ids.length > 0 && ids.every(id => selected.has(id))
    const delta = (remove ? 0 : ids.length) - ids.reduce<number>((count, id) => count + Number(selected.has(id)), 0)
    for (const id of ids) if (remove) selected.delete(id); else selected.add(id)
    const affected = new Map<string, { route: string[]; size: number }>([['[]', { route: [], size: current.current.total }]])
    api.forEachNode(item => { if (isDocumentHistoryGroupRow(item.data)) {
      const path = routeOf(item); affected.set(journalRouteKey(path), { route: path, size: item.data.childCount })
    } })
    current.current.select([...selected].map(id => ({ id })))
    setCounts(previous => {
      const next = { ...previous, [key]: remove ? 0 : ids.length }
      for (const [pathKey, group] of affected) {
        if (route.every((part, index) => group.route[index] === part)) next[pathKey] = remove ? 0 : group.size
        else if (group.route.every((part, index) => route[index] === part) && previous[pathKey] !== undefined) next[pathKey] = previous[pathKey] + delta
      }
      return next
    })
  })
  const parts = (copy: boolean): JournalRangePart<string>[] => {
    const { api, ready, columns } = current.current
    if (!api || api.isDestroyed() || !ready || !revision.current) return []
    const allowed = new Set(columns.map(column => column.key)), focused = api.getFocusedCell()
    const ranges = api.getCellRanges() ?? []
    const cells = ranges.length ? ranges : copy && focused ? [{ startRow: focused, endRow: focused, columns: [focused.column] }] : []
    const selected = cells.flatMap(range => range.startRow && range.endRow && !range.startRow.rowPinned && !range.endRow.rowPinned ? [{
      first: Math.min(range.startRow.rowIndex, range.endRow.rowIndex), last: Math.max(range.startRow.rowIndex, range.endRow.rowIndex),
      columns: range.columns.filter(column => column.isVisible() && allowed.has(column.getColId())).map(column => column.getColId()),
    }] : []).filter(range => range.columns.length)
    if (!selected.length) return []
    const stores = new Map(api.getServerSideGroupLevelState().map(store => [journalRouteKey(store.route), store]))
    const expanded: JournalRouteLayout[] = []
    api.forEachNode(node => {
      if (!node.expanded || !isDocumentHistoryGroupRow(node.data)) return
      const route = routeOf(node), store = stores.get(journalRouteKey(route))
      if (!store) throw new Error('Дождитесь загрузки раскрытых групп.')
      expanded.push({ route, ordinal: node.data.ordinal, rowCount: store.rowCount })
    })
    const root = stores.get('[]')
    if (!root || root.rowCount + expanded.reduce((sum, item) => sum + item.rowCount, 0) !== api.getDisplayedRowCount()) throw new Error('Дождитесь загрузки раскрытых групп.')
    const result = journalRangeParts(copy ? journalCopyRanges(selected, api.getAllDisplayedColumns().map(column => column.getColId())) : selected, root.rowCount, expanded)
    if (result.some(part => !stores.get(journalRouteKey(part.route))?.lastRowIndexKnown)) throw new Error('Дождитесь загрузки раскрытых групп.')
    return result.filter(part => part.route.length === query().rowGroupCols.length)
  }
  const updateRange = useStableEventCallback(() => {
    let ranges: JournalRangePart<string>[]
    try { ranges = parts(false) } catch (error) {
      rangeGeneration.current++; copyGeneration.current++; clearTimeout(rangeTimer.current); lastRanges.current = ''
      setCopying(false); setSummary(EMPTY_JOURNAL_RANGE_SUMMARY); setRangeState((error as Error).message); return
    }
    const signature = JSON.stringify([current.current.scope, revision.current, ranges])
    if (signature === lastRanges.current) return
    lastRanges.current = signature; clearTimeout(rangeTimer.current)
    if (copyingRanges.current !== null && copyingRanges.current !== visualSignature()) {
      copyGeneration.current++; copyingRanges.current = null; setCopying(false)
    }
    const requestId = ++rangeGeneration.current
    setSummary(EMPTY_JOURNAL_RANGE_SUMMARY); setRangeState(ranges.length ? 'Считаем…' : '')
    if (!ranges.length) return
    const { api, value } = current.current
    const nodes = new Map<number, IRowNode<T | DocumentHistoryGroupRow>>()
    api!.forEachNode(node => { if (node.rowIndex != null && node.data && !node.stub) nodes.set(node.rowIndex, node) })
    const allowed = new Set(current.current.columns.map(column => column.key))
    const spans = mergeJournalRangeSpans((api!.getCellRanges() ?? []).flatMap(range => range.startRow && range.endRow
      ? range.columns.filter(column => column.isVisible() && allowed.has(column.getColId())).map(column => ({ fieldKey: column.getColId(),
        first: Math.min(range.startRow!.rowIndex, range.endRow!.rowIndex), last: Math.max(range.startRow!.rowIndex, range.endRow!.rowIndex) })) : []))
    const cachedIndices = [...nodes.keys()]
    if (spans.every(span => span.last - span.first + 1 <= nodes.size
      && cachedIndices.filter(index => index >= span.first && index <= span.last).length === span.last - span.first + 1)) {
      const calculation = journalRangeSummaryChunks(spans, (index, key) => {
        const node = nodes.get(index)!
        return node.group || isDocumentHistoryGroupRow(node.data) || !node.data ? undefined : value(key, node.data)
      }, key => key === 'rowCount' || key === 'wdi')
      let next = calculation.next()
      while (!next.done) next = calculation.next()
      setSummary(next.value); setRangeState(''); return
    }
    const request = query(), load = current.current.load
    rangeTimer.current = setTimeout(() => {
      void (async () => {
        const result = { ...EMPTY_JOURNAL_RANGE_SUMMARY }
        const routes = new Map<string, typeof ranges>()
        for (const range of ranges) { const key = journalRouteKey(range.route), list = routes.get(key) ?? []; list.push(range); routes.set(key, list) }
        for (const list of routes.values()) {
          const blocks = new Map<string, { first: number; last: number; columns: string[] }>()
          for (const span of mergeJournalRangeSpans(list.flatMap(part => part.columns.map(fieldKey => ({ fieldKey, first: part.start, last: part.end - 1 }))))) {
            const key = `${span.first}:${span.last}`, block = blocks.get(key) ?? { first: span.first, last: span.last, columns: [] }
            block.columns.push(span.fieldKey); blocks.set(key, block)
          }
          for (const span of blocks.values()) {
            const next = await load({ ...request, groupKeys: list[0].route, startRow: span.first, endRow: span.last + 1, cells: { columns: span.columns, summary: true } })
            if (requestId !== rangeGeneration.current) return
            if (!next.summary) throw new Error('Не удалось получить полный итог диапазона.')
            result.count += next.summary.count; result.numericCount += next.summary.numericCount; result.sum += next.summary.sum
          }
        }
        result.average = result.numericCount ? result.sum / result.numericCount : null
        setSummary(result); setRangeState('')
      })().catch(error => { if (requestId === rangeGeneration.current) setRangeState(error.message) })
    }, 150)
  })
  const copy = useStableEventCallback(async () => {
    const requestId = ++copyGeneration.current
    let ranges: JournalRangePart<string>[]
    try { ranges = parts(true) } catch (error) { current.current.error((error as Error).message); return }
    if (!ranges.length) return
    const request = query(), { load } = current.current
    copyingRanges.current = visualSignature()
    setCopying(true)
    try {
      const assertCurrent = () => {
        if (requestId !== copyGeneration.current) throw new DOMException('Копирование отменено.', 'AbortError')
      }
      const text = (async () => {
        const lines: string[] = []
        const quote = (value: string | number, key: string) => {
          const text = key === 'wdi' || key === 'rowCount' ? gridClipboardNumber(value) : String(value)
          return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
        }
        for (const part of ranges) {
          for (let start = part.start; start < part.end; start += 500) {
            const result = await load({ ...request, groupKeys: part.route, startRow: start, endRow: Math.min(part.end, start + 500), cells: { columns: part.columns } })
            assertCurrent()
            if (result.cells?.length !== Math.min(500, part.end - start)) throw new Error('Диапазон изменился. Повторите копирование.')
            for (const row of result.cells) lines.push(row.map((value, index) => quote(value, part.columns[index])).join('\t'))
          }
        }
        assertCurrent()
        return lines.join('\n')
      })()
      await writeDeferredTextToClipboard(text)
    } catch (error) {
      if (requestId === copyGeneration.current) {
        // Stop subsequent batches if clipboard permission was refused early.
        copyGeneration.current++; copyingRanges.current = null; setCopying(false)
        current.current.error((error as Error).message || 'Не удалось скопировать диапазон.')
      }
    }
    finally { if (requestId === copyGeneration.current) { copyingRanges.current = null; setCopying(false) } }
  })
  return { accept, invalidate, revision, toggle, counts, selecting, summary, rangeState, updateRange, countSelection, copy, copying, trim }
}
