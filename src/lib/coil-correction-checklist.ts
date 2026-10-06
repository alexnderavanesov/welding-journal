import type { WeldRow } from './dispatcher-types'
import type { ProgramChainState } from './line-program-chain-state'
import { isClearedErroneousCoilRow } from './early-coil-candidate'

/** A read-only checklist, never an alternative permission to delete or restore. */
export function buildCoilCorrectionChecklist(rootId: number, rows: readonly WeldRow[], states: readonly ProgramChainState[],
  documented: ReadonlySet<number>, earlySourceIds: readonly number[]) {
  const byId = new Map(states.map(state => [state.weldJointId, state]))
  const earlyIds = new Set(earlySourceIds)
  const sourceRows: WeldRow[] = [], replacementRows: WeldRow[] = []
  for (const row of rows) {
    const state = byId.get(row.id)
    if (row.id === rootId || state?.kind === 'repair' && state.physicalRootId === rootId) sourceRows.push(row)
    else replacementRows.push(row)
  }
  const reference = (row: WeldRow) => ({ id: row.id, joint: String(row.joint ?? row.id),
    projectTitle: String(row.projectTitle ?? ''), subtitleCode: String(row.subtitleCode ?? ''), line: String(row.line ?? '') })
  // A weld date alone does not require removing NK documents. Early cancellation
  // separately requires cleared dates; ordinary deletion retains its own guards.
  const historyRows = replacementRows.filter(row => !isClearedErroneousCoilRow({ ...row, weldDate: null }, documented))
  return {
    sourceRows: sourceRows.map(reference), replacementRows: replacementRows.map(reference), historyRows: historyRows.map(reference),
    weldedRows: replacementRows.filter(row => String(row.weldDate ?? '').trim()).map(reference),
    earlySources: sourceRows.filter(row => earlyIds.has(row.id)).map(reference),
    replacedByCoil: byId.get(rootId)?.replacedByCoil === true,
  }
}

export type CoilCorrectionChecklist = ReturnType<typeof buildCoilCorrectionChecklist>
