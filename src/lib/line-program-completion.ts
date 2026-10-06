import type { WeldRow } from './dispatcher-types'
import { captureProgramChainStates } from './line-program-chain-state'
import { buildLineProgramTopology, programJointIdentity } from './line-program-topology'
import { isActiveOfficialWeld } from './control-assignment-eligibility'
import { calculateFinalStatus } from './weld-status'
import { getPrimaryRejectedLnkResult } from './repeated-joint-task-helpers'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import { buildJointChainConsistencyCheckTasks } from './repeated-joint-consistency-tasks'
import { buildRepeatedJointLookup } from './repeated-joint-lookup'
import { getEarlyCoilDecisionSourceRowIds } from './early-coil-decision'
import { buildProgramRepairTasks } from './line-program-repair-requirements'
import { buildChainActualityCheckTasks } from './chain-actuality-check'
import { isUnofficialJoint } from './joint-display'

/** Completion concerns surviving physical connections, not every historical row.
 * A good final does not conceal missing predecessors, competing finals, or an
 * unfinished/non-rejected predecessor. The quota calculation remains separate.
 */
export function countUnfinishedProgramChains(input: readonly WeldRow[], full: boolean, settings: SystemIndexSettings = loadSystemIndexSettings(), accepted: ReadonlySet<string> = new Set()) {
  const states = input.every(row => row.programChainState)
    ? new Map(input.map(row => [row.id, row.programChainState!])) : captureProgramChainStates(input, settings)
  const rows = input.map(row => ({ ...row, finalStatus: calculateFinalStatus(row), programChainState: states.get(row.id)! }))
  const actualityChecks = buildChainActualityCheckTasks(rows, settings)
  if (actualityChecks.length) return actualityChecks.length
  const topology = buildLineProgramTopology(rows, full, settings)
  if (topology.issues.length) return Math.max(1, topology.issues.length)
  const hasContinuations = rows.some(row => row.programChainState.kind !== 'primary')
  if (hasContinuations) {
    // Excluded parents remain evidence of how an active coil came into being.
    // Dropping them manufactures a missing predecessor / premature coil.
    const history = rows.filter(row => !isUnofficialJoint(row))
    const lookup = buildRepeatedJointLookup(history, getPrimaryRejectedLnkResult, settings)
    const checks = buildJointChainConsistencyCheckTasks(history, { getPrimaryRejectedLnkResult,
      getOfficialRejectedJointChainRows: (_rows, row, name) => lookup.getOfficialRejectedJointChainRows(row, name) }, settings, getEarlyCoilDecisionSourceRowIds(new Set(accepted)))
    if (checks.length) return checks.length
  }
  const missingRepairMethods = new Set(hasContinuations ? buildProgramRepairTasks(rows, accepted, settings).map(task => task.row.id) : [])
  const branches = new Map<number, WeldRow[]>()
  for (const row of rows) {
    if (!isActiveOfficialWeld(row)) continue
    const rootId = row.programChainState.physicalRootId
    if (rootId == null) continue
    const branch = branches.get(rootId) ?? []
    branch.push(row); branches.set(rootId, branch)
  }
  let unfinished = 0
  for (const root of topology.physicalRows.filter(isActiveOfficialWeld)) {
    const branch = branches.get(root.id) ?? [root]
    const ids = new Set(branch.map(row => row.id))
    const parents = new Set(branch.flatMap(row => row.programChainState?.kind === 'repair' && ids.has(row.programChainState.sourceRowId ?? -1)
      ? [row.programChainState.sourceRowId!] : []))
    const leaves = branch.filter(row => !parents.has(row.id))
    const names = new Set(branch.map(row => programJointIdentity(row)))
    if (leaves.length !== 1 || names.size !== branch.length || !leaves[0].weldDate || missingRepairMethods.has(leaves[0].id) || calculateFinalStatus(leaves[0]) !== 'годен' ||
      branch.some(row => row.id !== leaves[0].id && (!row.weldDate || !getPrimaryRejectedLnkResult(row) || calculateFinalStatus(row) === 'годен'))) unfinished++
  }
  return unfinished
}
