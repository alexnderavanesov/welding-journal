import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { getLnkRepairForbiddenReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { formatDateBeforeWeldDateSaveReason, isDateBeforeWeldDate } from '@/lib/report-date-rules'
import { LNK_CUSTOM_RESULT_VALUE, LNK_EMPTY_RESULT_VALUE, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import { DEFAULT_SAVE_CHECK_SETTINGS, type SaveCheckSettings } from '@/lib/save-check-settings'
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

export function getEffectiveLnkResultDraftValueForRow(
  row: WeldRow,
  draft: LnkResultDraftLike,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const result = getEffectiveLnkResultDraftValue(row.id, draft)
  return saveCheckSettings.lnkResultRepairRules && result === 'ремонт' && isLnkRepairForbidden(row) ? '' : result
}

export function getManagedLnkResultChangeKey(rowId: number, methodKey: WeldFieldKey) {
  return `${rowId}:${methodKey}`
}

export function buildLnkResultDraftById(
  rows: WeldRow[],
  draft: LnkResultDraftLike,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  return Object.fromEntries(rows.map((row) => [row.id, getEffectiveLnkResultDraftValueForRow(row, draft, saveCheckSettings)]))
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

export function assertLnkRepairAllowed(
  row: WeldRow,
  result: string | null,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.lnkResultRepairRules || result !== 'ремонт' || !isLnkRepairForbidden(row)) return
  throw new Error(`Ремонт недоступен для стыка ${String(row.joint ?? '-')}: ${getLnkRepairForbiddenReason(row)}`)
}

export function areLnkResultDraftRowsReady(
  rows: WeldRow[],
  draft: LnkResultDraftLike,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  return rows.length > 0 && rows.every((row) => isValidLnkResultDraftValue(getEffectiveLnkResultDraftValueForRow(row, draft, saveCheckSettings)))
}

export function hasNonEmptyLnkResultDraftRows(
  rows: WeldRow[],
  draft: LnkResultDraftLike,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  return rows.some((row) => getEffectiveLnkResultDraftValueForRow(row, draft, saveCheckSettings) !== LNK_EMPTY_RESULT_VALUE)
}

export function findFirstLnkResultDateBeforeWeldDateIssue(
  rows: WeldRow[],
  draft: LnkResultDraftLike,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.lnkResultDateAfterWeldDate) return null
  const method = getLnkMethodByRequestKey(draft.methodKey)
  if (!method) return null
  const row = rows.find((candidate) => {
    const result = getEffectiveLnkResultDraftValueForRow(candidate, draft, saveCheckSettings)
    return result !== LNK_EMPTY_RESULT_VALUE && isDateBeforeWeldDate(draft.controlDate, candidate.weldDate)
  })
  return row ? formatDateBeforeWeldDateSaveReason(row, draft.controlDate, `Дата контроля ${method.code}`) : null
}
