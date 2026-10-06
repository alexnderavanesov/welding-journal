import type { WeldRow } from './dispatcher-types'
import { captureProgramChainStates } from './line-program-chain-state'
import { programJointIdentity } from './line-program-topology'
import { isRevisionNotActual } from './revision-actuality'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'

/** One actuality decision belongs to one physical connection. Persisted IDs survive
 * renaming; same-name unofficial repeats share the decision. Y is a new root,
 * never an edge to its cut parent or to the other side of the coil. */
export function buildChainActualityGroups(rows: readonly WeldRow[], settings: SystemIndexSettings = loadSystemIndexSettings()) {
  const states = rows.every(row => row.programChainState)
    ? new Map(rows.map(row => [row.id, row.programChainState!])) : captureProgramChainStates(rows, settings)
  const parents = new Map<number, number>()
  const find = (id: number) => {
    let root = id
    while (parents.has(root)) root = parents.get(root)!
    while (parents.has(id)) { const next = parents.get(id)!; parents.set(id, root); id = next }
    return root
  }
  const roots = new Map(rows.map(row => [row.id, states.get(row.id)?.physicalRootId ?? row.id]))
  const names = new Map<string, number>()
  for (const row of rows) {
    if (!String(row.joint ?? '').trim() || !String(row.line ?? '').trim()) continue
    const identity = `${states.get(row.id)!.kind}:${programJointIdentity(row)}`
    const root = find(roots.get(row.id)!), prior = names.get(identity)
    if (prior == null) names.set(identity, root)
    else { const other = find(prior); if (root !== other) parents.set(Math.max(root, other), Math.min(root, other)) }
  }
  const groups = new Map<number, WeldRow[]>()
  for (const row of rows) {
    const key = find(roots.get(row.id)!), group = groups.get(key) ?? []
    group.push(row); groups.set(key, group)
  }
  return { states, groups: [...groups.entries()].map(([id, members]) => ({
    id, rows: members.sort((a, b) => a.id - b.id),
    mixed: members.some(row => isRevisionNotActual(row.revisionActuality)) && members.some(row => !isRevisionNotActual(row.revisionActuality)),
  })) }
}
