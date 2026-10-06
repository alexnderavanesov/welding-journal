import type { WeldRow } from '@/lib/dispatcher-types'
import { calculateLineProgram, getLineProgramOfficialStamps, isLineProgramCalculationRow, isLineProgramControlRow, type LineProgramDemand, type LineProgramStampCalculation } from '@/lib/line-program-calculation'
import { partitionProgramExcess, programExcessIdentity, getProgramRemovalHints, countProgramRemovalHints, type ProgramRemovalHints } from './line-program-excess'
import { PROGRAM_METHODS, programAssignment, programExcessEntries } from '@/lib/line-program-workspace'
import type { LineProgramRecord } from '@/lib/line-program'
import { getProgramDemandAccounting } from './line-program-accounting'
import { calculateFinalStatus } from './weld-status'
import { buildLineProgramTopology } from './line-program-topology'
import { programApprovalKey } from './program-control-approval'
import { countUnfinishedProgramChains } from './line-program-completion'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'

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
  // Keep every row for physical replacement history, but only eligible controls contribute to totals.
  const controlRows = rows.filter(isLineProgramControlRow)
  const topology = buildLineProgramTopology(rows, line.weldControlPercent === 100, settings)
  const physical = topology.physicalRows.filter(isLineProgramControlRow)
  const eligible = physical.filter(line.weldControlPercent === 100 ? isLineProgramControlRow : isLineProgramCalculationRow)
  const states = controlRows.map(calculateFinalStatus)
  const errors = states.filter(state => state === 'ошибка').length
  const overview: LineProgramOverview = {
    joints: physical.length, journalRows: rows.length, calculationJoints: eligible.length,
    stamps: new Set(controlRows.flatMap(getLineProgramOfficialStamps).map((s) => s.toLocaleLowerCase('ru'))).size,
    common: null, pvk: null,
    additional: controlRows.filter(row => PROGRAM_METHODS.some(method => programAssignment(row, method) === 'дополнительный')).length,
    approved: 0, reducible: 0, pending: states.filter(state => state.startsWith('ожидает')).length,
    rejected: states.filter(state => state.startsWith('не годен')).length,
    unfinishedChains: countUnfinishedProgramChains(rows, line.weldControlPercent === 100, settings, accepted),
    ...(errors ? { errors } : {}),
    ...(topology.issues.length ? { integrityIssues: topology.issues.length } : {}),
  }
  if (line.configurationIssue || line.weldControlPercent == null || line.pvkControlPercent == null) return overview
  const calculations = calculated ?? calculateLineProgram(rows, line.weldControlPercent, line.pvkControlPercent, settings, accepted)
  const excess = partitionProgramExcess(programExcessEntries(line.id, rows, calculations), accepted)
  overview.reducible = countProgramRemovalHints(removalHints ?? getProgramRemovalHints(line.id, rows, calculations, accepted))
  overview.approved = new Set(excess.approved.map(programExcessIdentity)).size
  const visibleApproved = new Set(excess.approved.map(entry => entry.key))
  for (const row of controlRows) for (const kind of ['common', 'pvk'] as const) for (const duplicate of [false, true]) {
    const key = programApprovalKey(row, kind, duplicate)
    if (accepted.has(key) && !visibleApproved.has(key)) { overview.approved++; visibleApproved.add(key) }
  }
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
