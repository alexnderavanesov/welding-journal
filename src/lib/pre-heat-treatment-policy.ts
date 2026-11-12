import type { WeldInput } from '@/lib/weld-fields'
import { isControlEnabledValue } from './control-availability-values'

export type PreHeatTreatmentMode = 'selected' | 'allPsto'

export function isPreHeatTreatmentRequiredByMode(row: WeldInput, _legacyMode = row.preHeatTreatmentMode) {
  return row.preHeatTreatmentRequired === true
}

export type PreHeatTreatmentPolicyRow = WeldInput

export function isPreHeatTreatmentStageEnabled(row: PreHeatTreatmentPolicyRow) {
  return isPreHeatTreatmentRequiredByMode(row)
}

export function isPreHeatTreatmentApplicable(row: PreHeatTreatmentPolicyRow) {
  return isPreHeatTreatmentStageEnabled(row) && isControlEnabledValue(row.pstoRequired)
}
