import type { WeldInput } from '@/lib/weld-fields'

export type PreHeatTreatmentPolicyRow = WeldInput & {
  /** Current server setting, not a user-editable or persisted weld field. */
  preHeatTreatmentLnkEnabled?: boolean
}

export function isPreHeatTreatmentStageEnabled(row: PreHeatTreatmentPolicyRow) {
  return row.preHeatTreatmentLnkEnabled !== false
}
