import type { WeldRow } from '@/lib/dispatcher-types'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import { groupPreHeatTreatmentControls, mergePreHeatTreatmentControlsIntoRows } from '@/lib/heat-treatment-control-relations'
import type { PreHeatTreatmentControlRecord } from '@/lib/lnk-control-stage'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import {
  hasPstoCycleExecutionHistory,
  type PstoRepeatCycleRecord,
} from '@/lib/psto-cycle'

export function prepareStatisticsHeatTreatmentRows(
  rows: readonly WeldRow[],
  repeatCycles: readonly PstoRepeatCycleRecord[],
  preHeatTreatmentControls: readonly PreHeatTreatmentControlRecord[],
  settings?: Pick<ControlProcessSettings, 'preHeatTreatmentMode'>,
) {
  const hydrated = mergePreHeatTreatmentControlsIntoRows(
    applyLatestPstoCycleToStatisticsRows(rows, repeatCycles),
    preHeatTreatmentControls,
  )
  if (settings) for (const row of hydrated) row.preHeatTreatmentMode = settings.preHeatTreatmentMode
  return hydrated
}

export function applyLatestPstoCycleToStatisticsRows(
  rows: readonly WeldRow[],
  repeatCycles: readonly PstoRepeatCycleRecord[],
) {
  return applyLatestPstoCycle(rows, repeatCycles, false)
}

/** Server statistics owns its freshly selected rows. Stage readers consume the
 * relation arrays; materializing dozens of virtual display cells per joint is
 * unnecessary for the aggregate and retains several copies of the full set. */
export function prepareStatisticsHeatTreatmentRowsInPlace(
  rows: WeldRow[], repeatCycles: readonly PstoRepeatCycleRecord[],
  controls: readonly PreHeatTreatmentControlRecord[],
  settings: Pick<ControlProcessSettings, 'preHeatTreatmentMode'>,
) {
  applyLatestPstoCycle(rows, repeatCycles, true)
  const byId = groupPreHeatTreatmentControls(controls)
  for (const row of rows) {
    row.preHeatTreatmentControls = byId.get(row.id) ?? []
    row.preHeatTreatmentMode = settings.preHeatTreatmentMode
  }
  return rows
}

function applyLatestPstoCycle(rows: readonly WeldRow[], repeatCycles: readonly PstoRepeatCycleRecord[], inPlace: boolean) {
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
    const target = inPlace ? row : { ...row }
    if (!cycle) return Object.assign(target, { pstoRepeatCycles: cycles })
    return Object.assign(target, {
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
    })
  })
}

export const applyLatestRepeatTvmtToStatisticsRows = applyLatestPstoCycleToStatisticsRows
