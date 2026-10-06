import type { WeldRow } from '@/lib/dispatcher-types'
import type { SystemIndexSettings } from '@/lib/system-index-settings'
import { calculateFinalStatus, normalizeFinalStatus } from '@/lib/weld-status'
import { encodeIdentityKey } from '@/lib/identity-key'
import { getLineProgramIdentityKey } from '@/lib/line-program'
import {
  calculateLineProgram, isLineProgramCalculationRow, isLineProgramControlRow, parseLineProgramPercent,
  type LineProgramDemand, type LineProgramStampCalculation,
} from '@/lib/line-program-calculation'
import { buildLineProgramTopology } from './line-program-topology'


export type PercentageLineStampSummary = {
  key: string
  stamp: string
  lineKey: string
  projectTitle: string
  subtitleCode: string
  line: string
  percent: number
  officialJointCount: number
  baseRequiredControls: number
  additionalRequiredControls: number
  calculatedRequiredControls: number
  availableRequiredControls: number
  requiredControls: number
  assignedControls: number
  normalAssignedControls: number
  additionalAssignedControls: number
  cancelledAssignedControls: number
  coveredControls: number
  rejectedCoveredControls: number
  completedControls: number
  rejectedControlRows: number
  goodJoints: number
  rejectedJoints: number
  waitingRequestJoints: number
  waitingControlJoints: number
  assignedJointNames: string[]
  assignedRowIds: number[]
  additionalAssignedJointNames: string[]
  additionalAssignedRowIds: number[]
  cancelledAssignedJointNames: string[]
  cancelledAssignedRowIds: number[]
  coveredJointNames: string[]
  coveredRowIds: number[]
  rejectedCoveredJointNames: string[]
  rejectedCoveredRowIds: number[]
  completedJointNames: string[]
  completedRowIds: number[]
  rejectedJointNames: string[]
  rejectedRowIds: number[]
  missingCandidateJointNames: string[]
  missingCandidateRowIds: number[]
  assignmentCandidateJointNames: string[]
  assignmentCandidateRowIds: number[]
  excessCandidateJointNames: string[]
  excessCandidateRowIds: number[]
  missingControls: number
  excessControls: number
  fullControlRequired: boolean
  common: LineProgramDemand
  pvk: LineProgramDemand
  duplicateAssignmentRowIds: number[]
}

export type PercentageLineSummary = {
  lineKey: string
  projectTitle: string
  subtitleCode: string
  line: string
  percent: number
  rowCount: number
  rows: WeldRow[]
  stamps: PercentageLineStampSummary[]
}


export const PERCENTAGE_LINE_NEW_WELDER_WARNING_KEY_PREFIX = 'percentage-line-control:new-welder:'
export function getPercentageLineNewWelderWarningKey(summaryKey: string) {
  return `${PERCENTAGE_LINE_NEW_WELDER_WARNING_KEY_PREFIX}${summaryKey}`
}

/** Dispatcher projection using the same full-line engine as the program. */
export function buildPercentageLineSummaries(
  rows: WeldRow[],
  systemIndexSettings?: SystemIndexSettings,
  approved: ReadonlySet<string> = new Set(),
): PercentageLineSummary[] {
  const lines = new Map<string, WeldRow[]>()
  for (const row of rows) {
    if (!String(row.line ?? '').trim()) continue
    const key = getLineProgramIdentityKey(row)
    const group = lines.get(key) ?? []
    group.push(row)
    lines.set(key, group)
  }
  return [...lines].flatMap(([lineKey, allRows]) => {
    const metadataRows = allRows.filter(row => String(row.revisionActuality ?? '').trim().toLowerCase() !== 'не актуален')
    if (!metadataRows.length) return []
    for (const field of ['category', 'groupName'] as const) {
      // Legacy projections may omit metadata; persisted rows have explicit nulls.
      if (metadataRows.every((row) => row[field] === undefined)) continue
      const values = new Set(metadataRows.map((row) => String(row[field] ?? '').trim().toLocaleLowerCase('ru')))
      if (values.size !== 1 || values.has('')) return []
    }
    const percents = new Set(metadataRows.map((row) => parseLineProgramPercent(row.weldControlPercent)))
    const pvkPercents = new Set(metadataRows.map((row) => parseLineProgramPercent(
      row.pvkControlPercent === undefined ? row.weldControlPercent : row.pvkControlPercent,
    )))
    if (percents.size !== 1 || percents.has(null) || pvkPercents.size !== 1 || pvkPercents.has(null)) return []
    const percent = [...percents][0]!
    const pvkPercent = [...pvkPercents][0]!
    if (percent === 100 ? pvkPercent < 1 : pvkPercent > percent) return []
    const calculationRows = buildLineProgramTopology(allRows, percent === 100, systemIndexSettings).physicalRows.filter(percent === 100 ? isLineProgramControlRow : isLineProgramCalculationRow)
    const sample = allRows[0]
    const group = {
      lineKey, projectTitle: String(sample.projectTitle ?? '').trim(),
      subtitleCode: String(sample.subtitleCode ?? '').trim(), line: String(sample.line ?? '').trim(), percent,
    }
    const rowById = new Map(allRows.map((row) => [row.id, row]))
    const calculations = calculateLineProgram(allRows, percent, pvkPercent, systemIndexSettings, approved)
    if (!calculationRows.length && !calculations.length) return []
    const stamps = calculations.map((stamp) => toSummary(group, stamp, rowById)).sort((a, b) =>
      b.officialJointCount - a.officialJointCount || b.excessControls - a.excessControls || a.stamp.localeCompare(b.stamp, 'ru', { numeric: true }))
    const contextIds = new Set(calculations.flatMap(item => item.contextRowIds ?? item.rowIds))
    return [{ ...group, rows: allRows.filter(row => contextIds.has(row.id)), rowCount: calculationRows.length, stamps }]
  }).sort((a, b) => b.stamps.reduce((sum, s) => sum + s.requiredControls, 0) - a.stamps.reduce((sum, s) => sum + s.requiredControls, 0) ||
    b.stamps.length - a.stamps.length || a.projectTitle.localeCompare(b.projectTitle, 'ru', { numeric: true }) ||
    a.subtitleCode.localeCompare(b.subtitleCode, 'ru', { numeric: true }) || a.line.localeCompare(b.line, 'ru', { numeric: true }))
}

function toSummary(
  group: Pick<PercentageLineSummary, 'lineKey' | 'projectTitle' | 'subtitleCode' | 'line' | 'percent'>,
  stamp: LineProgramStampCalculation,
  rows: ReadonlyMap<number, WeldRow>,
): PercentageLineStampSummary {
  const demand = stamp.common
  const names = (ids: readonly number[]) => ids.map((id) => String(rows.get(id)?.joint ?? '').trim() || `#${id}`)
  const counters = { goodJoints: 0, rejectedJoints: 0, waitingRequestJoints: 0, waitingControlJoints: 0 }
  for (const id of stamp.rowIds) {
    const status = normalizeFinalStatus(calculateFinalStatus(rows.get(id)!))
    if (status === 'годен') counters.goodJoints++
    else if (status === 'не годен') counters.rejectedJoints++
    else if (status === 'ожидает заявку') counters.waitingRequestJoints++
    else if (status === 'ожидает НК') counters.waitingControlJoints++
  }
  // Match the program's «Назначено»: active yes/additional only. Cancellation
  // can still cover quota, but is displayed separately rather than as an assignment.
  const assignedIds = [...new Set([...demand.assignedRowIds, ...demand.additionalRowIds])]
  const rejectedSet = new Set(stamp.rejectedRowIds)
  const rejectedCoveredIds = demand.coveredRowIds.filter((id) => rejectedSet.has(id))
  const excessIds = [...new Set([...demand.excessRowIds, ...demand.duplicateAssignmentRowIds])]
  return {
    ...group, key: encodeIdentityKey([group.lineKey, stamp.stamp.toLocaleLowerCase('ru')]), stamp: stamp.stamp,
    officialJointCount: stamp.rowIds.length,
    baseRequiredControls: demand.baseRequired, additionalRequiredControls: demand.additionalRequired,
    calculatedRequiredControls: demand.required,
    availableRequiredControls: demand.coveredRowIds.length + demand.candidateRowIds.length,
    requiredControls: demand.actionableRequired,
    assignedControls: assignedIds.length, normalAssignedControls: demand.assignedRowIds.length,
    additionalAssignedControls: demand.additionalRowIds.length, cancelledAssignedControls: demand.cancelledRowIds.length,
    coveredControls: demand.coveredRowIds.length, completedControls: demand.completedRowIds.length,
    rejectedCoveredControls: rejectedCoveredIds.length, rejectedControlRows: stamp.rejectedRowIds.length,
    ...counters,
    assignedRowIds: assignedIds, assignedJointNames: names(assignedIds),
    additionalAssignedRowIds: demand.additionalRowIds, additionalAssignedJointNames: names(demand.additionalRowIds),
    cancelledAssignedRowIds: demand.cancelledRowIds, cancelledAssignedJointNames: names(demand.cancelledRowIds),
    coveredRowIds: demand.coveredRowIds, coveredJointNames: names(demand.coveredRowIds),
    rejectedCoveredRowIds: rejectedCoveredIds, rejectedCoveredJointNames: names(rejectedCoveredIds),
    completedRowIds: demand.completedRowIds, completedJointNames: names(demand.completedRowIds),
    rejectedRowIds: stamp.rejectedRowIds, rejectedJointNames: names(stamp.rejectedRowIds),
    missingCandidateRowIds: demand.candidateRowIds, missingCandidateJointNames: names(demand.candidateRowIds),
    assignmentCandidateRowIds: demand.candidateRowIds, assignmentCandidateJointNames: names(demand.candidateRowIds),
    excessCandidateRowIds: excessIds, excessCandidateJointNames: names(excessIds),
    missingControls: demand.missing, excessControls: demand.excessAssignments?.length ?? excessIds.length, fullControlRequired: stamp.fullControlRequired,
    common: demand, pvk: stamp.pvk, duplicateAssignmentRowIds: demand.duplicateAssignmentRowIds,
  }
}
