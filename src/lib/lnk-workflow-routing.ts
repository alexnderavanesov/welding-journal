import type { WeldRow } from '@/lib/dispatcher-types'
import {
  PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE,
  PRE_HEAT_TREATMENT_LNK_METHODS,
  PRIMARY_LNK_CONTROL_STAGE,
  isPrimaryLnkStageReady,
  type LnkControlStage,
} from '@/lib/lnk-control-stage'
import { getAvailableLnkRequestMethods } from '@/lib/lnk-status'
import { getPendingLnkResultMethods } from '@/lib/lnk-result-navigation'
import {
  canAddPreHeatTreatmentResult,
  canCreatePreHeatTreatmentRequest,
} from '@/lib/pre-heat-treatment-control-updates'

export function getAvailablePreHeatTreatmentRequestMethods(row: WeldRow) {
  return PRE_HEAT_TREATMENT_LNK_METHODS.filter((method) =>
    canCreatePreHeatTreatmentRequest(row, method.code),
  )
}

export function getAvailablePreHeatTreatmentResultMethods(row: WeldRow) {
  return PRE_HEAT_TREATMENT_LNK_METHODS.filter((method) =>
    canAddPreHeatTreatmentResult(row, method.code),
  )
}

export function getPreferredLnkRequestStage(row: WeldRow): LnkControlStage | null {
  if (getAvailablePreHeatTreatmentRequestMethods(row).length > 0) {
    return PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE
  }
  if (getAvailableLnkRequestMethods(row).length > 0) return PRIMARY_LNK_CONTROL_STAGE
  return null
}

export function getPreferredLnkResultStage(row: WeldRow): LnkControlStage | null {
  if (getAvailablePreHeatTreatmentResultMethods(row).length > 0) {
    return PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE
  }
  const hasAvailablePrimaryResult = getPendingLnkResultMethods(row).some((method) =>
    isPrimaryLnkStageReady(row, method.code),
  )
  return hasAvailablePrimaryResult ? PRIMARY_LNK_CONTROL_STAGE : null
}

export function canCreateLnkWorkflowRequest(row: WeldRow) {
  return getPreferredLnkRequestStage(row) !== null
}

export function canAddLnkWorkflowResult(row: WeldRow) {
  return getPreferredLnkResultStage(row) !== null
}

export function getCommonLnkRequestStage(rows: WeldRow[]) {
  return getCommonStage(rows, getPreferredLnkRequestStage)
}

export function getCommonLnkResultStage(rows: WeldRow[]) {
  return getCommonStage(rows, getPreferredLnkResultStage)
}

function getCommonStage(
  rows: WeldRow[],
  resolveStage: (row: WeldRow) => LnkControlStage | null,
) {
  if (rows.length === 0) return null
  const firstStage = resolveStage(rows[0]!)
  if (!firstStage) return null
  return rows.every((row) => resolveStage(row) === firstStage) ? firstStage : null
}
