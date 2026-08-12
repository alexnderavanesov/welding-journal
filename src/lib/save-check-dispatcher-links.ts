import type { DispatcherSettingId } from '@/lib/dispatcher-settings'
import type { SaveCheckSettingId } from '@/lib/save-check-settings'

type SaveCheckDispatcherLink = readonly [SaveCheckSettingId, DispatcherSettingId]

export const SAVE_CHECK_DISPATCHER_LINKS = [
  ['officialRegistry', 'check-welder-stamp'],
  ['officialArchive', 'check-welder-stamp'],
  ['officialNaksDate', 'check-welder-stamp'],
  ['officialSuspension', 'check-welder-stamp'],
  ['officialWeldingMethod', 'check-welder-stamp'],
  ['officialMaterialGroup', 'check-welder-stamp'],
  ['officialDiameter', 'check-welder-stamp'],
  ['officialThickness', 'check-welder-stamp'],
  ['officialDls', 'check-welder-stamp'],
  ['requiredRootStampWithWeldDate', 'check-incomplete-stamps'],
  ['requiredMaterialGroupWithWeldDate', 'check-joint-core-data'],
  ['requiredConnectionTypeWithWeldDate', 'check-joint-core-data'],
  ['requiredWeldingMethodWithWeldDate', 'check-joint-core-data'],
  ['weldDateNotFuture', 'check-joint-core-data'],
  ['lnkResultControlDateRequired', 'check-lnk-result-completeness'],
  ['lnkResultDateAfterWeldDate', 'check-lnk-request-date-order'],
  ['lnkResultRequestDateOrder', 'check-lnk-request-date-order'],
  ['lnkResultVikDateBeforeOther', 'check-lnk-vik-date-order'],
  ['lnkResultVikRequiredBeforeOther', 'check-lnk-vik-required'],
  ['lnkResultConclusionRequired', 'check-lnk-result-completeness'],
  ['lnkResultRepairRules', 'check-repair-diameter'],
  ['pstoResultDateRequired', 'check-psto-result-completeness'],
  ['pstoResultDateAfterWeldDate', 'check-psto-request-date-order'],
  ['pstoResultRequestDateOrder', 'check-psto-request-date-order'],
  ['pstoResultDiagramRequired', 'check-psto-result-completeness'],
  ['manualJointName', 'check-joint-core-data'],
  ['controlHistoryProtection', 'check-control-history'],
] as const satisfies readonly SaveCheckDispatcherLink[]

export function getDispatcherSettingIdsForSaveCheck(id: SaveCheckSettingId): DispatcherSettingId[] {
  return SAVE_CHECK_DISPATCHER_LINKS
    .filter(([saveCheckId]) => saveCheckId === id)
    .map(([, dispatcherId]) => dispatcherId)
}

export function getSaveCheckSettingIdsForDispatcher(id: DispatcherSettingId): SaveCheckSettingId[] {
  return SAVE_CHECK_DISPATCHER_LINKS
    .filter(([, dispatcherId]) => dispatcherId === id)
    .map(([saveCheckId]) => saveCheckId)
}
