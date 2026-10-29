import type { GridApi, IRowNode } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { journalGroup, journalRouteKey, type JournalGridBlock, type JournalGridResult } from './journal-server-grid'

export type JournalRefreshBlock = JournalGridBlock & { rowCount: number; nodes: IRowNode<WeldRow>[] }
export const journalBlockKey = (block: JournalGridBlock) => JSON.stringify([block.route, block.start, block.end])

/** Snapshot only cached nodes. Never allocate an array sized to the database.
 * A partly loaded block takes the ordinary refresh path instead of certifying
 * unloaded placeholders as current. Group ordinals are store-local; leaf
 * stores have no expanded children, so their displayed offsets are exact.
 */
export function collectJournalRefreshBlocks(api: GridApi<WeldRow>): JournalRefreshBlock[] | null {
  const stores = api.getServerSideGroupLevelState()
  const counts = new Map(stores.map(store => [journalRouteKey(store.route), store.rowCount]))
  if (!stores.length || stores.some(store => !store.lastRowIndexKnown)) return null
  const blocks = new Map<string, JournalRefreshBlock>()
  let incomplete = false
  api.forEachNode(node => {
    if (!node.data || node.stub || node.rowIndex == null) { incomplete = true; return }
    const route = node.parent?.getRoute() ?? []
    const index = journalGroup(node.data)?.ordinal ?? node.rowIndex - (node.parent?.rowIndex ?? -1) - 1
    const rowCount = counts.get(journalRouteKey(route))
    if (!Number.isSafeInteger(index) || index < 0 || rowCount === undefined || index >= rowCount) { incomplete = true; return }
    const start = Math.floor(index / 100) * 100, end = start + 100
    const key = journalBlockKey({ route, start, end })
    let block = blocks.get(key)
    if (!block) { block = { route, start, end, rowCount, nodes: [] }; blocks.set(key, block) }
    block.nodes[index - start] = node
  })
  for (const block of blocks.values()) {
    const length = Math.min(block.end, block.rowCount) - block.start
    if (block.nodes.length !== length || Array.from({ length }, (_, index) => !block.nodes[index]).some(Boolean)) incomplete = true
  }
  if (incomplete || stores.some(store => store.rowCount > 0 && ![...blocks.values()].some(block => journalRouteKey(block.route) === journalRouteKey(store.route)))) return null
  if (!blocks.size) return null
  return [...blocks.values()].sort((a, b) => a.route.length - b.route.length || journalRouteKey(a.route).localeCompare(journalRouteKey(b.route)) || a.start - b.start)
}

export function journalRefreshBlocksUnchanged(before: JournalRefreshBlock[], after: JournalRefreshBlock[] | null) {
  return Boolean(after && before.length === after.length && before.every((block, index) => {
    const other = after[index]
    return journalBlockKey(block) === journalBlockKey(other) && block.rowCount === other.rowCount &&
      block.nodes.length === other.nodes.length && block.nodes.every((node, i) => node === other.nodes[i])
  }))
}

export function planJournalBlockRefresh(blocks: JournalRefreshBlock[], results: JournalGridResult[]) {
  const routes = new Map<string, { route: string[]; refresh: boolean; update: WeldRow[] }>()
  blocks.forEach((block, index) => {
    const result = results[index], key = journalRouteKey(block.route)
    const plan = routes.get(key) ?? { route: block.route, refresh: false, update: [] }
    routes.set(key, plan)
    const identity = (row: WeldRow) => journalGroup(row) ? journalRouteKey(journalGroup(row)!.route) : String(row.id)
    if (!result || result.rowCount !== block.rowCount || result.rows.length !== block.nodes.length ||
      result.rows.some((row, i) => identity(row) !== identity(block.nodes[i].data!))) plan.refresh = true
    else result.rows.forEach((row, i) => {
      // Compare all facts and server-derived metadata, not just updatedAt:
      // related workflows can change a status without changing that timestamp.
      if (JSON.stringify(row) !== JSON.stringify(block.nodes[i].data)) plan.update.push(row)
    })
  })
  return [...routes.values()]
}
