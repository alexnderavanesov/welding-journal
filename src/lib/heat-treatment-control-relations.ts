import {
  PRE_HEAT_TREATMENT_LNK_METHODS,
  type PreHeatTreatmentControlRecord,
} from '@/lib/lnk-control-stage'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import { attachPreHeatTreatmentReportValues } from '@/lib/pre-heat-treatment-report-fields'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type HeatTreatmentControlRelationsCarrier = {
  id: number
  preHeatTreatmentControls?: PreHeatTreatmentControlRecord[]
  pstoRepeatCycles?: PstoRepeatCycleRecord[]
}

const PRE_HEAT_METHOD_ORDER = new Map<string, number>(
  PRE_HEAT_TREATMENT_LNK_METHODS.map((method, index) => [method.code, index]),
)

export function mergePreHeatTreatmentControlsIntoRows<
  Row extends HeatTreatmentControlRelationsCarrier,
>(
  rows: readonly Row[],
  controls: readonly PreHeatTreatmentControlRecord[],
): Array<Row & Partial<Record<WeldFieldKey, unknown>> & {
  preHeatTreatmentControls: PreHeatTreatmentControlRecord[]
}> {
  const controlsByWeldId = new Map<number, PreHeatTreatmentControlRecord[]>()
  for (const control of controls) {
    const current = controlsByWeldId.get(control.weldJointId) ?? []
    current.push(control)
    controlsByWeldId.set(control.weldJointId, current)
  }

  for (const records of controlsByWeldId.values()) {
    records.sort(
      (left, right) =>
        getPreHeatMethodOrder(left.method) - getPreHeatMethodOrder(right.method) ||
        left.id - right.id,
    )
  }

  return rows.map((row) => {
    const rowControls = controlsByWeldId.get(row.id) ?? []
    return {
      ...attachPreHeatTreatmentReportValues(row, rowControls),
      preHeatTreatmentControls: rowControls,
    }
  })
}

export function mergePstoRepeatCyclesIntoRows<
  Row extends HeatTreatmentControlRelationsCarrier,
>(
  rows: readonly Row[],
  cycles: readonly PstoRepeatCycleRecord[],
): Array<Row & { pstoRepeatCycles: PstoRepeatCycleRecord[] }> {
  const cyclesByWeldId = new Map<number, PstoRepeatCycleRecord[]>()
  for (const cycle of cycles) {
    const current = cyclesByWeldId.get(cycle.weldJointId) ?? []
    current.push(cycle)
    cyclesByWeldId.set(cycle.weldJointId, current)
  }

  for (const records of cyclesByWeldId.values()) {
    records.sort((left, right) => left.sequence - right.sequence || left.id - right.id)
  }

  return rows.map((row) => ({
    ...row,
    pstoRepeatCycles: cyclesByWeldId.get(row.id) ?? [],
  }))
}

function getPreHeatMethodOrder(method: string) {
  return PRE_HEAT_METHOD_ORDER.get(String(method ?? '').trim().toLocaleUpperCase('ru-RU')) ?? Number.MAX_SAFE_INTEGER
}
