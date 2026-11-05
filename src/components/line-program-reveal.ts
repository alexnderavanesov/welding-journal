import type { GridApi, IFilter, IRowNode } from 'ag-grid-community'
import type { LineProgramRecord } from '@/lib/line-program'

export function currentProgramTarget(api: GridApi<LineProgramRecord>, target: Pick<LineProgramRecord, 'id' | 'version'>) {
  if (api.isDestroyed()) return undefined
  const node = api.getRowNode(String(target.id))
  // Another client may already have saved again. Showing its newer version is
  // valid; only the pre-save row must wait. This never grants write permission.
  if (!node?.data || node.data.version !== target.version &&
    !(Date.parse(node.data.version) >= Date.parse(target.version))) return undefined
  return node
}

/** Reveal an explicit save/navigation target without changing a matching filter.
 * Returns false while AG still has the old row or has not received it yet. */
export function revealProgramLine(api: GridApi<LineProgramRecord>, target: Pick<LineProgramRecord, 'id' | 'version'>) {
  const node = currentProgramTarget(api, target)
  if (!node) return false
  let matchesFilter = false
  api.forEachNodeAfterFilter(candidate => { if (candidate === node) matchesFilter = true })
  if (!matchesFilter) api.setFilterModel(null)
  const ancestors = []
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.group && parent.level >= 0) ancestors.unshift(parent)
  for (const parent of ancestors) if (!parent.expanded) parent.setExpanded(true, undefined, true)
  return true
}

/** Keep every compatible column filter. An explicit composition must be fully visible. */
export async function revealProgramComposition<T>(api: GridApi<T>, ids: readonly string[], current: () => boolean = () => true) {
  const live = () => current() && !api.isDestroyed()
  if (!live()) return []
  const nodes = ids.map(id => api.getRowNode(id)).filter((node): node is IRowNode<T> => !!node?.data)
  if (nodes.length !== ids.length) return []
  const cleared: string[] = []
  for (const column of Object.keys(api.getFilterModel())) {
    const filter = await api.getColumnFilterInstance<IFilter>(column)
    if (!live()) return []
    if (filter && nodes.some(node => !filter.doesFilterPass({ node, data: node.data }))) {
      await api.setColumnFilterModel(column, null)
      cleared.push(api.getColumn(column)?.getColDef().headerName ?? column)
    }
  }
  if (!live()) return []
  if (cleared.length) api.onFilterChanged()
  const ancestors = new Set<IRowNode<T>>()
  for (const node of nodes) for (let parent = node.parent; parent; parent = parent.parent) if (parent.group && parent.level >= 0) ancestors.add(parent)
  for (const parent of [...ancestors].sort((a, b) => a.level - b.level)) if (!parent.expanded) parent.setExpanded(true, undefined, true)
  return cleared
}
