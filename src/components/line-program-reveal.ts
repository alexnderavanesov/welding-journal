import type { GridApi } from 'ag-grid-community'
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
