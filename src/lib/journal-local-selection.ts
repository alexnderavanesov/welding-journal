import type { GridApi } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { journalGroup, journalRouteKey } from './journal-server-grid'

/** Exact memberships only: a partly loaded group must still use the server.
 * Called for selection/model changes, never for scroll or column resize. */
export function readJournalLocalSelection(api: Pick<GridApi<WeldRow>, 'forEachNode'>, total?: number) {
  const groups = new Map<string, { total: number; ids: Set<number> }>()
  const root = new Set<number>()
  api.forEachNode(node => {
    const group = journalGroup(node.data)
    if (group) {
      const key = journalRouteKey(group.route)
      const entry = groups.get(key)
      groups.set(key, { total: group.recordCount, ids: entry?.ids ?? new Set() })
    }
    if (!node.data || node.group || node.stub || group) return
    root.add(node.data.id)
    for (let parent = node.parent; parent; parent = parent.parent) {
      const ancestor = journalGroup(parent.data)
      if (!ancestor) continue
      const key = journalRouteKey(ancestor.route)
      let entry = groups.get(key)
      if (!entry) { entry = { total: ancestor.recordCount, ids: new Set() }; groups.set(key, entry) }
      entry.ids.add(node.data.id)
    }
  })
  const complete = new Map<string, ReadonlySet<number>>()
  for (const [key, group] of groups) if (group.ids.size === group.total) complete.set(key, group.ids)
  if (total !== undefined && root.size === total) complete.set('[]', root)
  return complete
}
