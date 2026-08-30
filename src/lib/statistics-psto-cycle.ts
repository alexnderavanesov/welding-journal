import type { WeldRow } from '@/lib/dispatcher-types'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import { mergePreHeatTreatmentControlsIntoRows } from '@/lib/heat-treatment-control-relations'
import type { PreHeatTreatmentControlRecord } from '@/lib/lnk-control-stage'
import {
  hasPstoCycleExecutionHistory,
  type PstoRepeatCycleRecord,
} from '@/lib/psto-cycle'

export function prepareStatisticsHeatTreatmentRows(
  rows: readonly WeldRow[],
  repeatCycles: readonly PstoRepeatCycleRecord[],
  preHeatTreatmentControls: readonly PreHeatTreatmentControlRecord[],
) {
  return mergePreHeatTreatmentControlsIntoRows(
    applyLatestPstoCycleToStatisticsRows(rows, repeatCycles),
    preHeatTreatmentControls,
  )
}

export function applyLatestPstoCycleToStatisticsRows(
  rows: readonly WeldRow[],
  repeatCycles: readonly PstoRepeatCycleRecord[],
) {
  const latestByWeldId = new Map<number, PstoRepeatCycleRecord>()
  const cyclesByWeldId = new Map<number, PstoRepeatCycleRecord[]>()
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  for (const cycle of repeatCycles) {
    const row = rowsById.get(cycle.weldJointId)
    if (
      row &&
      !isControlEnabledValue(row.pstoRequired) &&
      !hasPstoCycleExecutionHistory(cycle)
    ) continue
    const cycles = cyclesByWeldId.get(cycle.weldJointId) ?? []
    cycles.push(cycle)
    cyclesByWeldId.set(cycle.weldJointId, cycles)
    const current = latestByWeldId.get(cycle.weldJointId)
    if (
      !current ||
      cycle.sequence > current.sequence ||
      (cycle.sequence === current.sequence && cycle.id > current.id)
    ) {
      latestByWeldId.set(cycle.weldJointId, cycle)
    }
  }

  return rows.map((row) => {
    const cycles = cyclesByWeldId.get(row.id) ?? []
    const cycle = latestByWeldId.get(row.id)
    if (!cycle) return { ...row, pstoRepeatCycles: cycles }
    return {
      ...row,
      pstoRequest: cycle.pstoRequest ?? null,
      pstoRequestDate: cycle.pstoRequestDate ?? null,
      pstoDate: cycle.pstoDate ?? null,
      heatTreatmentDiagram: cycle.heatTreatmentDiagram ?? null,
      pstoResult: cycle.pstoResult ?? null,
      pstoNote: cycle.pstoNote ?? null,
      tvmtRequest: cycle.tvmtRequest ?? null,
      tvmtRequestDate: cycle.tvmtRequestDate ?? null,
      tvmtResult: cycle.tvmtResult ?? null,
      tvmtConclusionDate: cycle.tvmtConclusionDate ?? null,
      tvmtConclusion: cycle.tvmtConclusion ?? null,
      pstoRepeatCycles: cycles,
    }
  })
}

export const applyLatestRepeatTvmtToStatisticsRows = applyLatestPstoCycleToStatisticsRows
