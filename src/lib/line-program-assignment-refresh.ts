import type { WeldRow } from './dispatcher-types'
import { PROGRAM_EDITOR_METHODS, programAssignment, type ProgramMethod } from './line-program-workspace'

/** Drafts can be rebuilt without changing assignments. Only compare values
 * belonging to this table; line-wide hints remain independent React context. */
export function getProgramAssignmentRefresh(
  rows: readonly WeldRow[], previous: ReadonlyMap<number, WeldRow>, next: ReadonlyMap<number, WeldRow>,
) {
  const candidates = new Set([...previous.keys(), ...next.keys()])
  const rowIds: number[] = [], methods = new Set<ProgramMethod>()
  for (const row of rows) {
    if (!candidates.has(row.id)) continue
    const before = previous.get(row.id) ?? row, after = next.get(row.id) ?? row
    let changed = false
    for (const method of PROGRAM_EDITOR_METHODS) if (programAssignment(before, method) !== programAssignment(after, method)) {
      methods.add(method); changed = true
    }
    if (changed) rowIds.push(row.id)
  }
  return { rowIds, methods: [...methods] }
}
