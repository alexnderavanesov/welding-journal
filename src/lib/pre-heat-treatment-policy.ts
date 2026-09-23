import { hasPstoExecutionHistory, type PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import type { WeldInput } from '@/lib/weld-fields'

export type PreHeatTreatmentPolicyRow = WeldInput & {
  preHeatTreatmentLnkExempt?: boolean
  /** Current server setting, not a user-editable or persisted weld field. */
  preHeatTreatmentLnkEnabled?: boolean
  pstoRepeatCycles?: PstoRepeatCycleRecord[]
}

export function isPreHeatTreatmentStageEnabled(row: PreHeatTreatmentPolicyRow) {
  return row.preHeatTreatmentLnkEnabled !== false
}

/** Waiting labels and free-text notes are not evidence of a started process. */
export function hasOwnPstoStart(row: PreHeatTreatmentPolicyRow) {
  return hasText(row.pstoRequest) || hasText(row.pstoRequestDate) ||
    hasPstoExecutionHistory(row, row.pstoRepeatCycles) ||
    (row.pstoRepeatCycles ?? []).some((cycle) => hasText(cycle.pstoRequest) || hasText(cycle.pstoRequestDate))
}

export function hasHistoricalPreHeatTreatmentExemption(row: PreHeatTreatmentPolicyRow) {
  return row.preHeatTreatmentLnkExempt === true && hasOwnPstoStart(row)
}

/** Use the pre-mutation facts so a line flag cannot revive when PSTO starts. */
export function getPreHeatTreatmentExemptionForSave(
  next: PreHeatTreatmentPolicyRow,
  previous: PreHeatTreatmentPolicyRow = next,
) {
  return hasOwnPstoStart(next) && (
    !isPreHeatTreatmentStageEnabled(previous) || hasHistoricalPreHeatTreatmentExemption(previous)
  )
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}
