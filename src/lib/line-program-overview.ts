import type { WeldRow } from '@/lib/dispatcher-types'
import { calculateLineProgram, getLineProgramOfficialStamps, isLineProgramCalculationRow, isLineProgramControlRow, type LineProgramDemand, type LineProgramStampCalculation } from '@/lib/line-program-calculation'
import { partitionProgramExcess, programExcessIdentity, getProgramRemovalHints, countProgramRemovalHints, type ProgramRemovalHints } from './line-program-excess'
import { PROGRAM_METHODS, programAssignment, programExcessEntries } from '@/lib/line-program-workspace'
import type { LineProgramRecord } from '@/lib/line-program'
import { getProgramDemandAccounting } from './line-program-accounting'
import { calculateFinalStatus } from './weld-status'
import { buildLineProgramTopology } from './line-program-topology'
import { countUnfinishedProgramChains } from './line-program-completion'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import { buildSupportProgramContext, getSupportChainMethodState } from './support-program-calculation'
import { isTConnectionType } from './connection-type'

/** Keep the core's capped debt: the raw quota is context, not an unreachable assignment task. */
export function compactLineProgramDemand(demand: LineProgramDemand) {
  const accounting = getProgramDemandAccounting(demand)
  return { percent: demand.percent, baseRequired: demand.baseRequired, additionalRequired: demand.additionalRequired,
    required: demand.required, actionableRequired: demand.actionableRequired, missing: demand.missing,
    assigned: accounting.assignments.total, additional: demand.additionalRowIds.length, accounting,
    cancelled: demand.cancelledRowIds.length, covered: demand.coveredRowIds.length,
    completed: demand.completedRowIds.length, candidates: demand.candidateRowIds.length,
    excess: demand.excessAssignments?.filter(entry => !entry.duplicate).length ?? demand.excessRowIds.length,
    duplicateAssignments: demand.excessAssignments?.filter(entry => entry.duplicate).length ?? demand.duplicateAssignmentRowIds.length }
}
export type LineProgramDemandSummary = ReturnType<typeof compactLineProgramDemand>
export type LineProgramOverview = {
  joints: number
  journalRows?: number
  calculationJoints: number
  stamps: number
  additional: number
  approved: number
  reducible: number
  pending: number
  rejected: number
  errors?: number
  integrityIssues?: number
  unfinishedChains?: number
  common: { required: number; covered: number; missing: number; actionableRequired: number; excess: number } | null
  pvk: { required: number; covered: number; missing: number; actionableRequired: number; excess: number } | null
}

/** Historical rejected rows remain visible, but a repaired/replaced chain can finish. */
export function isLineProgramFinished(overview: LineProgramOverview | null | undefined) {
  return !!overview && overview.joints > 0 && overview.common?.missing === 0 && overview.pvk?.missing === 0
    && (overview.unfinishedChains == null ? overview.pending === 0 && overview.rejected === 0 && (overview.errors ?? 0) === 0 : overview.unfinishedChains === 0)
    && (overview.integrityIssues ?? 0) === 0
}

/** Quotas are summed per stamp; physical joint counts are never summed across stamps. */
export function summarizeLineProgram(rows: readonly WeldRow[], line: LineProgramRecord, accepted: ReadonlySet<string> = new Set(), calculated?: readonly LineProgramStampCalculation[], settings: SystemIndexSettings = loadSystemIndexSettings(), removalHints?: ProgramRemovalHints): LineProgramOverview {
  const support = line.family === 'supports'
  rows = rows.filter(row => isTConnectionType(row.connectionType) === support)
  // Keep every row for physical replacement history, but only eligible controls contribute to totals.
  const controlRows = rows.filter(isLineProgramControlRow)
  const supportContext = support ? buildSupportProgramContext(rows, settings) : null
  const topology = supportContext?.topology ?? buildLineProgramTopology(rows, line.weldControlPercent === 100, settings)
  const physical = topology.physicalRows.filter(isLineProgramControlRow)
  const eligible = physical.filter(!support && line.weldControlPercent === 100 ? isLineProgramControlRow : row => isLineProgramCalculationRow(row) && (!support || getLineProgramOfficialStamps(row).length > 0))
  const states = controlRows.map(calculateFinalStatus)
  const errors = states.filter(state => state === 'ошибка').length
  const overview: LineProgramOverview = {
    joints: physical.length, journalRows: rows.length, calculationJoints: eligible.length,
    stamps: new Set((support ? physical : controlRows).flatMap(getLineProgramOfficialStamps).map((s) => s.toLocaleLowerCase('ru'))).size,
    common: null, pvk: null,
    additional: supportContext ? physical.filter(row => (['common', 'pvk'] as const).some(kind => getSupportChainMethodState(supportContext.members.get(row.id) ?? [row], kind).additional)).length : controlRows.filter(row => PROGRAM_METHODS.some(method => programAssignment(row, method) === 'дополнительный')).length,
    approved: 0, reducible: 0, pending: states.filter(state => state.startsWith('ожидает')).length,
    rejected: states.filter(state => state.startsWith('не годен')).length,
    unfinishedChains: countUnfinishedProgramChains(rows, support || line.weldControlPercent === 100, settings, accepted),
    ...(errors ? { errors } : {}),
    ...(topology.issues.length ? { integrityIssues: topology.issues.length } : {}),
  }
  if (line.configurationIssue || line.weldControlPercent == null || line.pvkControlPercent == null) return overview
  const calculations = calculated ?? calculateLineProgram(rows, line.weldControlPercent, line.pvkControlPercent, settings, accepted, line.family === 'supports')
  const excess = partitionProgramExcess(programExcessEntries(line.id, rows, calculations), accepted)
  overview.reducible = countProgramRemovalHints(removalHints ?? getProgramRemovalHints(line.id, rows, calculations, accepted))
  overview.approved = 0
  for (const kind of ['common', 'pvk'] as const) {
    overview[kind] = calculations.reduce((total, stamp) => {
      const demand = stamp[kind]
      total.required += demand.required
      total.covered += Math.min(demand.required, demand.coveredRowIds.length)
      total.missing += demand.missing
      total.actionableRequired += demand.actionableRequired
      return total
    }, { required: 0, covered: 0, missing: 0, actionableRequired: 0, excess: new Set(excess.pending.filter(entry => entry.kind === kind).map(programExcessIdentity)).size })
  }
  return overview
}

export function isProgramControlComplete(row: WeldRow) {
  return calculateFinalStatus(row) === 'годен'
}

export function isProgramControlRejected(row: WeldRow) {
  return calculateFinalStatus(row).startsWith('не годен')
}
