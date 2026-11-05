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

/** Basis text updates through the editor's React context. It must not trigger
 * filter rebuilding or line-wide quota/history calculations on every keystroke.
 * The returned rows are for calculations only, never for rendering/saving bases. */
export function createProgramAssignmentRowsSelector() {
  let source: readonly WeldRow[] | undefined
  let previous: ReadonlyMap<number, WeldRow> = new Map()
  let selected: readonly WeldRow[] = []
  return (rows: readonly WeldRow[], draft: ReadonlyMap<number, WeldRow>) => {
    if (rows !== source || getProgramAssignmentRefresh(rows, previous, draft).methods.length) {
      selected = draft.size ? rows.map(row => draft.get(row.id) ?? row) : rows
    }
    source = rows
    previous = draft
    return selected
  }
}
