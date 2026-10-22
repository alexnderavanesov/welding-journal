import type { GridApi, IRowNode } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { journalGroup, journalRouteKey } from './journal-server-grid'

// Full joint cards are expensive; expanded group metadata must remain so that
// purging an old leaf store never collapses it or changes visual row positions.
export const JOURNAL_LEAF_CACHE_BUDGET = 2000
export function createJournalCacheBudget(limit = JOURNAL_LEAF_CACHE_BUDGET) {
  let clock = 0
  const loads = new Map<string, { count: number; used: number }>()
  return {
    clear() { loads.clear() },
    loaded(route: string[], count: number) { loads.set(journalRouteKey(route), { count, used: ++clock }) },
    trim(api: GridApi<WeldRow>) {
      if (api.isDestroyed() || !api.getRowGroupColumns().length) return 0
      const first = api.getFirstDisplayedRowIndex() - 100, last = api.getLastDisplayedRowIndex() + 100
      const focus = api.getFocusedCell()?.rowIndex
      const endpoints = (api.getCellRanges() ?? []).flatMap(range => [range.startRow?.rowIndex, range.endRow?.rowIndex])
      const stores = new Map<string, { route: string[]; parent: IRowNode<WeldRow>; cards: number }>()
      let cards = 0
      api.forEachNode(node => {
        const group = journalGroup(node.parent?.data)
        if (node.group || !node.data || node.stub || !group || !node.parent) return
        const key = journalRouteKey(group.route)
        const store = stores.get(key) ?? { route: group.route, parent: node.parent, cards: 0 }
        store.cards++; cards++; stores.set(key, store)
      })
      for (const key of loads.keys()) if (!stores.has(key)) loads.delete(key)
      if (cards <= limit) return 0
      const candidates = [...stores.entries()].filter(([key, store]) => {
        const load = loads.get(key)
        if (!load || store.parent.rowIndex == null || !store.parent.expanded) return false
        const start = store.parent.rowIndex + 1, end = start + load.count - 1
        const contains = (index: number | undefined) => index !== undefined && index >= start && index <= end
        if (end >= first && start <= last || contains(focus) || endpoints.some(contains)) {
          load.used = ++clock
          return false
        }
        return true
      }).sort(([a], [b]) => loads.get(a)!.used - loads.get(b)!.used)
      let removed = 0
      for (const [key, store] of candidates) {
        if (cards <= limit) break
        const count = loads.get(key)!.count
        // Both public calls are synchronous. Restore the exact extent in the same
        // task; our model consumers coalesce their reads into the next frame.
        api.refreshServerSide({ route: store.route, purge: true })
        api.applyServerSideRowData({ route: store.route, startRow: 0, successParams: { rowData: [], rowCount: count } })
        cards -= store.cards; removed += store.cards; loads.delete(key)
      }
      return removed
    },
  }
}
