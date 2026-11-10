import type { WeldRow } from './dispatcher-types'
import type { ProgramChainState } from './line-program-chain-state'
import type { SystemIndexSettings } from './system-index-settings'
import { getCoilJointNames, normalizeJointChainPart, parseRepeatedJointName } from './joint-chain'

type Member = { weldJointId: number; physicalId: number }
export type SchemePointContextSource = {
  members: (query: { physicalIds?: number[]; nodeIds?: number[] }) => Promise<Member[]>
  states: (query: { nodeIds?: number[]; rootIds?: number[]; coilParentIds?: number[] }) => Promise<ProgramChainState[]>
  /** Both selectors are restricted to the requested live line. Names are normalized. */
  rows: (query: { ids?: number[]; names?: string[] }) => Promise<WeldRow[]>
}

/** Read the connected physical histories, not the unrelated line. Expansion is
 * batched by frontier and every node/name/root is queried once. Same-name edges
 * only supply candidates; the canonical projection still decides whether they
 * are actual official continuations. Deleted labels never create an edge.
 */
export async function collectSchemePointContext(physicalIds: readonly number[], settings: SystemIndexSettings, source: SchemePointContextSource) {
  const rows = new Map<number, WeldRow>(), states = new Map<number, ProgramChainState>(), membership = new Map<number, number>()
  const physicals = new Set<number>(), stateIds = new Set<number>(), roots = new Set<number>(), liveIds = new Set<number>(), names = new Set<string>(), memberIds = new Set<number>()
  const physicalQueue = new Set(physicalIds), stateQueue = new Set<number>(), rootQueue = new Set<number>(), liveQueue = new Set<number>(), nameQueue = new Set<string>(), memberQueue = new Set<number>()
  let requiresFullLine = false
  const take = <T>(queue: Set<T>, seen: Set<T>) => { const next = [...queue].filter(value => !seen.has(value)); queue.clear(); for (const value of next) seen.add(value); return next }
  const node = (id: number) => { if (!stateIds.has(id)) stateQueue.add(id); if (!liveIds.has(id)) liveQueue.add(id); if (!memberIds.has(id)) memberQueue.add(id) }
  const state = (value: ProgramChainState) => {
    states.set(value.weldJointId, value); stateIds.add(value.weldJointId)
    if (!liveIds.has(value.weldJointId)) liveQueue.add(value.weldJointId)
    if (!memberIds.has(value.weldJointId)) memberQueue.add(value.weldJointId)
    if (value.physicalRootId != null) { node(value.physicalRootId); if (!roots.has(value.physicalRootId)) rootQueue.add(value.physicalRootId) }
    if (value.kind === 'repair' && value.sourceRowId != null) node(value.sourceRowId)
  }
  const member = (value: Member) => {
    membership.set(value.weldJointId, value.physicalId); memberIds.add(value.weldJointId)
    if (!physicals.has(value.physicalId)) physicalQueue.add(value.physicalId)
    node(value.weldJointId)
    if (!roots.has(value.weldJointId)) rootQueue.add(value.weldJointId)
  }
  const live = (value: WeldRow) => {
    liveIds.add(value.id)
    if (rows.has(value.id)) return
    rows.set(value.id, value)
    const name = normalizeJointChainPart(value.joint); if (name && !names.has(name)) nameQueue.add(name)
    if (!memberIds.has(value.id)) memberQueue.add(value.id)
    if (value.programChainState) state(value.programChainState)
    else requiresFullLine = true // Legacy inference needs the complete line.
  }
  while (physicalQueue.size || stateQueue.size || rootQueue.size || liveQueue.size || nameQueue.size || memberQueue.size) {
    const ids = take(physicalQueue, physicals)
    if (ids.length) for (const value of await source.members({ physicalIds: ids })) member(value)
    const nodes = take(stateQueue, stateIds), rootIds = take(rootQueue, roots)
    if (nodes.length || rootIds.length) {
      for (const value of await source.states({ nodeIds: nodes, rootIds })) state(value)
      for (const id of [...nodes, ...rootIds]) if (!liveIds.has(id)) liveQueue.add(id)
    }
    const liveNodes = take(liveQueue, liveIds)
    if (liveNodes.length) for (const value of await source.rows({ ids: liveNodes })) live(value)
    if (requiresFullLine) break
    const jointNames = take(nameQueue, names)
    if (jointNames.length) for (const value of await source.rows({ names: jointNames })) live(value)
    if (requiresFullLine) break
    const members = take(memberQueue, memberIds)
    if (members.length) for (const value of await source.members({ nodeIds: members })) member(value)
  }
  if (!requiresFullLine && rows.size) {
    // A Y is a separate physical entity. Read only its own welding fact as
    // replacement evidence; do not traverse the Y's repairs or grandchildren.
    const supportIds = new Set<number>()
    for (const value of await source.states({ coilParentIds: [...states.keys()] })) {
      if (!states.has(value.weldJointId)) states.set(value.weldJointId, value)
      if (!liveIds.has(value.weldJointId)) supportIds.add(value.weldJointId)
    }
    const coilNames = [...new Set([...rows.values()].flatMap(value => getCoilJointNames(parseRepeatedJointName(String(value.joint ?? ''), settings).base, settings).map(normalizeJointChainPart)))].filter(name => !names.has(name))
    const support = supportIds.size || coilNames.length ? await source.rows({ ids: [...supportIds], names: coilNames }) : []
    for (const value of support) {
      if (!value.programChainState) { requiresFullLine = true; break }
      if (!rows.has(value.id)) rows.set(value.id, value)
      states.set(value.id, value.programChainState)
    }
  }
  return { rows: [...rows.values()].sort((a, b) => a.id - b.id), states, membership, requiresFullLine }
}
