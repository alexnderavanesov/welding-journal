import { hasRejectedLnkResult } from '@/lib/lnk-status'
import {
  LNK_GENERATED_FIELD_KEYS,
  LNK_METHODS,
} from '@/lib/report-config'
import {
  hasText,
  hasWeldDate,
  getCancelledLnkResultDisplay,
  getCancelledPstoResultDisplay,
  hasRealLnkResultValue,
  isCancelledControlValue,
  isEnabledControlValue,
  isPendingLnkResultValue,
  isYesText,
} from '@/lib/report-value-utils'
import type { WeldInput } from '@/lib/weld-fields'

export function hasAnyLnkControl(row: WeldInput) {
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]))
}

export function hasAnyLnkGeneratedData(row: WeldInput) {
  return [...LNK_GENERATED_FIELD_KEYS].some((fieldKey) => hasText(row[fieldKey]))
}

export function hasAnyLnkReportControl(row: WeldInput) {
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]) || isCancelledLnkControl(row, method))
}

export function hasLnkReportEntry(row: WeldInput) {
  return hasWeldDate(row) && hasAnyLnkReportControl(row)
}

export function withOfficialJointStatus(record: WeldInput) {
  return { ...record, status: null }
}

export function withPendingLnkResults<T extends WeldInput>(row: T): T {
  let nextRow: (T & Record<string, unknown>) | null = null
  for (const method of LNK_METHODS) {
    if (!isEnabledControlValue(row[method.enabledKey])) continue
    if (hasText(row[method.resultKey]) && !isPendingLnkResultValue(row[method.resultKey])) continue
    nextRow = nextRow ?? ({ ...row } as T & Record<string, unknown>)
    nextRow[method.resultKey] = hasText(row[method.requestKey]) ? 'ожидает НК' : 'ожидает заявку'
  }
  return (nextRow ?? row) as T
}

export function toLnkReportRow<T extends WeldInput>(row: T): T {
  return toControlCancellationReportRow(row)
}

export function toControlCancellationReportRow<T extends WeldInput>(row: T): T {
  let nextRow: (T & Record<string, unknown>) | null = null
  if (isCancelledPstoControl(row)) {
    nextRow = { ...row } as T & Record<string, unknown>
    nextRow.pstoRequired = 'отменен'
    nextRow.pstoResult = getCancelledPstoResultDisplay(row.pstoResult)
  }
  for (const method of LNK_METHODS) {
    if (!isCancelledLnkControl(row, method)) continue
    nextRow = nextRow ?? ({ ...row } as T & Record<string, unknown>)
    nextRow[method.enabledKey] = 'отменен'
    nextRow[method.resultKey] = getCancelledLnkResultDisplay(row[method.resultKey])
  }
  return (nextRow ?? row) as T
}

export function hasHeatTreatmentReportState(row: WeldInput) {
  return isYesText(row.pstoRequired) || isCancelledPstoControl(row)
}

export function toHeatTreatmentReportRow<T extends WeldInput>(row: T): T {
  return toControlCancellationReportRow(row)
}

export function isCancelledPstoControl(row: WeldInput) {
  return isCancelledControlValue(row.pstoRequired)
}

export function isCancelledLnkControl(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  return isCancelledControlValue(row[method.enabledKey])
}

export function hasLnkMethodReportHistory(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  return hasRealLnkResultValue(row[method.resultKey]) || hasText(row[method.conclusionDateKey]) || hasText(row[method.conclusionKey])
}

export function canCreateLnkRequest(row: WeldInput) {
  if (hasRejectedLnkResult(row)) return false
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]) && !hasText(row[method.requestKey]))
}
