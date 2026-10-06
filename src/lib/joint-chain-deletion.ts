import type { WeldRow } from './dispatcher-types'
import { captureProgramChainStates } from './line-program-chain-state'
import type { SystemIndexSettings } from './system-index-settings'

/** Preserve descendants regardless of officiality/actuality. Deletion is physical
 * history editing, not percentage eligibility. A selected whole branch is allowed. */
export function getRetainedChainDependants(rows: readonly WeldRow[], selectedIds: ReadonlySet<number>, settings?: SystemIndexSettings) {
  const states = captureProgramChainStates(rows, settings)
  const children = new Map<number, number[]>()
  for (const state of states.values()) for (const parent of new Set([state.sourceRowId, state.physicalRootId, state.coilParentId])) {
    if (parent == null || parent === state.weldJointId) continue
    const group = children.get(parent) ?? []
    group.push(state.weldJointId); children.set(parent, group)
  }
  const reached = new Set(selectedIds), queue = [...selectedIds]
  for (let index = 0; index < queue.length; index++) for (const child of children.get(queue[index]) ?? []) {
    if (!reached.has(child)) { reached.add(child); queue.push(child) }
  }
  return rows.filter(row => reached.has(row.id) && !selectedIds.has(row.id))
}

export function chainDeletionBlockMessage(rows: readonly { id: number; joint?: unknown; line?: unknown }[]) {
  const examples = rows.slice(0, 6).map(row => `${String(row.joint ?? row.id)}${row.line ? ` (${row.line})` : ''}`).join(', ')
  return `Нельзя удалить предшественника: остаются продолжения цепочки — ${examples}. Удаляйте с конца цепочки либо выберите всю удаляемую ветку вместе с её продолжениями. Неофициальность и неактуальность не отменяют эту защиту. Ничего не удалено.`
}
