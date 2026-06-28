import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { getLnkRepairForbiddenReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { formatDateBeforeWeldDateSaveReason, isDateBeforeWeldDate } from '@/lib/report-date-rules'
import { LNK_CUSTOM_RESULT_VALUE, LNK_EMPTY_RESULT_VALUE, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type LnkResultDraftLike = {
  methodKey: WeldFieldKey | ''
  rowResults: Record<number, string>
  controlDate: string
  result: string
}

export function getEffectiveLnkResultDraftValue(rowId: number, draft: LnkResultDraftLike) {
  return draft.rowResults[rowId] || (draft.result === LNK_CUSTOM_RESULT_VALUE ? '' : draft.result)
}

export function getEffectiveLnkResultDraftValueForRow(row: WeldRow, draft: LnkResultDraftLike) {
  const result = getEffectiveLnkResultDraftValue(row.id, draft)
  return result === 'ремонт' && isLnkRepairForbidden(row) ? '' : result
}

export function getManagedLnkResultChangeKey(rowId: number, methodKey: WeldFieldKey) {
  return `${rowId}:${methodKey}`
}

export function buildLnkResultDraftById(rows: WeldRow[], draft: LnkResultDraftLike) {
  return Object.fromEntries(rows.map((row) => [row.id, getEffectiveLnkResultDraftValueForRow(row, draft)]))
}

export function filterLnkResultDraftRowResults(rowResults: Record<number, string>, rowIds: ReadonlySet<number>) {
  return Object.fromEntries(Object.entries(rowResults).filter(([rowId]) => rowIds.has(Number(rowId))))
}

export function isValidLnkResultDraftValue(value: string) {
  return value === LNK_EMPTY_RESULT_VALUE || LNK_RESULT_OPTIONS.includes(value as never)
}

export function assertValidLnkResultValue(value: string) {
  if (!LNK_RESULT_OPTIONS.includes(value as never)) throw new Error('Укажите корректный результат')
}

export function assertLnkRepairAllowed(row: WeldRow, result: string | null) {
  if (result !== 'ремонт' || !isLnkRepairForbidden(row)) return
  throw new Error(`Ремонт недоступен для стыка ${String(row.joint ?? '-')}: ${getLnkRepairForbiddenReason(row)}`)
}

export function areLnkResultDraftRowsReady(rows: WeldRow[], draft: LnkResultDraftLike) {
  return rows.length > 0 && rows.every((row) => isValidLnkResultDraftValue(getEffectiveLnkResultDraftValueForRow(row, draft)))
}

export function hasNonEmptyLnkResultDraftRows(rows: WeldRow[], draft: LnkResultDraftLike) {
  return rows.some((row) => getEffectiveLnkResultDraftValueForRow(row, draft) !== LNK_EMPTY_RESULT_VALUE)
}

export function findFirstLnkResultDateBeforeWeldDateIssue(rows: WeldRow[], draft: LnkResultDraftLike) {
  const method = getLnkMethodByRequestKey(draft.methodKey)
  if (!method) return null
  const row = rows.find((candidate) => {
    const result = getEffectiveLnkResultDraftValueForRow(candidate, draft)
    return result !== LNK_EMPTY_RESULT_VALUE && isDateBeforeWeldDate(draft.controlDate, candidate.weldDate)
  })
  return row ? formatDateBeforeWeldDateSaveReason(row, draft.controlDate, `Дата контроля ${method.code}`) : null
}
