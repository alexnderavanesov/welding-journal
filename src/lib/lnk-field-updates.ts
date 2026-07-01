import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import {
  hasAnyLnkGeneratedData,
  hasLnkMethodReportHistory,
  hasLnkReportEntry,
} from '@/lib/report-control-state'
import {
  LNK_GENERATED_FIELD_KEYS,
  LNK_METHODS,
  LNK_REQUEST_FIELD_KEYS,
} from '@/lib/report-config'
import { isSameImportValue } from '@/lib/report-import'
import {
  isPendingLnkResultValue,
  hasText,
  isCancelledControlValue,
  isEnabledControlValue,
} from '@/lib/report-value-utils'
import {
  calculateFinalStatus,
  RESULT_STATUS_OPTIONS,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'

export function isLnkResultField(fieldKey: WeldFieldKey) {
  return LNK_METHODS.some((method) => method.resultKey === fieldKey)
}

export function isLnkRequestField(fieldKey: WeldFieldKey) {
  return LNK_REQUEST_FIELD_KEYS.includes(fieldKey)
}

export function isLnkRequestAllowedForRow(row: WeldInput, fieldKey: WeldFieldKey) {
  const method = getLnkMethodByRequestKey(fieldKey)
  return !method || isEnabledControlValue(row[method.enabledKey])
}

export function applyLnkFieldUpdate<T extends WeldInput>(record: T, fieldKey: WeldFieldKey, value: string | null): T {
  const nextRecord = { ...record, [fieldKey]: value } as T & Record<string, unknown>
  const requestMethod = getLnkMethodByRequestKey(fieldKey)
  if (requestMethod && !hasText(value)) {
    nextRecord[requestMethod.resultKey] = null
    nextRecord[requestMethod.conclusionDateKey] = null
    nextRecord[requestMethod.conclusionKey] = null
  }
  return nextRecord as T
}

export function clearLnkGeneratedData<T extends WeldInput>(row: T): T {
  const nextRow = { ...row } as T & Record<string, unknown>
  for (const fieldKey of LNK_GENERATED_FIELD_KEYS) {
    nextRow[fieldKey] = null
  }
  return nextRow as T
}

export function hasLnkGeneratedDataChanged(left: WeldInput, right: WeldInput) {
  return [...LNK_GENERATED_FIELD_KEYS].some((fieldKey) => !isSameImportValue(left[fieldKey], right[fieldKey]))
}

export function clearDisabledLnkRequests<T extends WeldInput>(row: T): T {
  let nextRow: (T & Record<string, unknown>) | null = null
  for (const method of LNK_METHODS) {
    if (isEnabledControlValue(row[method.enabledKey]) || hasLnkMethodReportHistory(row, method)) continue
    if (!hasText(row[method.requestKey]) && !isPendingLnkResultValue(row[method.resultKey])) continue
    nextRow = nextRow ?? ({ ...row } as T & Record<string, unknown>)
    nextRow[method.requestKey] = null
    if (isPendingLnkResultValue(row[method.resultKey])) {
      nextRow[method.resultKey] = null
    }
  }
  return (nextRow ?? row) as T
}

export function clearCancelledRejectedLnkGeneratedData<T extends WeldInput>(row: T): T {
  let nextRow: (T & Record<string, unknown>) | null = null
  for (const method of LNK_METHODS) {
    if (!isCancelledControlValue(row[method.enabledKey]) || !isRejectedLnkResultValue(row[method.resultKey])) continue
    nextRow = nextRow ?? ({ ...row } as T & Record<string, unknown>)
    nextRow[method.requestKey] = null
    nextRow[method.resultKey] = null
    nextRow[method.conclusionDateKey] = null
    nextRow[method.conclusionKey] = null
  }
  return (nextRow ?? row) as T
}

export function restoreActiveLnkCancelledResults<T extends WeldInput>(row: T): T {
  let nextRow: (T & Record<string, unknown>) | null = null
  for (const method of LNK_METHODS) {
    if (!isEnabledControlValue(row[method.enabledKey])) continue

    const restoredResult = getRestoredActiveLnkResult(row[method.resultKey])
    if (restoredResult === undefined) continue

    nextRow = nextRow ?? ({ ...row } as T & Record<string, unknown>)
    nextRow[method.resultKey] = restoredResult
  }
  return (nextRow ?? row) as T
}

export function normalizeLnkResultValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return RESULT_STATUS_OPTIONS.includes(text as never) ? text : null
}

function getRestoredActiveLnkResult(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'годен (отменен)') return 'годен'
  if (text === 'отменен') return null
  return undefined
}

function isRejectedLnkResultValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'ремонт' || text === 'вырез'
}

export function withLnkCreatedAt<T extends WeldInput>(rows: T[]) {
  const lnkCreatedAt = new Date().toISOString()
  return rows.map((row) => ((hasLnkReportEntry(row) || hasAnyLnkGeneratedData(row)) && !row.lnkCreatedAt ? { ...row, lnkCreatedAt } : row))
}

export function withTouchedLnkTimestamp<T extends WeldInput>(row: T): T {
  return { ...row, lnkCreatedAt: new Date().toISOString() }
}

export function withLnkFinalStatus<T extends WeldInput>(row: T) {
  return { ...row, finalStatus: calculateFinalStatus(row) }
}

export function withTouchedLnkFinalStatus<T extends WeldInput>(row: T) {
  return withLnkFinalStatus(withTouchedLnkTimestamp(row))
}
