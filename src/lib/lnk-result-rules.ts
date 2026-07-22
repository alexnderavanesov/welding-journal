import { getRepeatedJointRepairCount, parseRepeatedJointName } from '@/lib/joint-chain'
import { formatJointDiameterLabel, getMinimumJointDiameter, isUnofficialJoint } from '@/lib/joint-display'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON } from '@/lib/report-config'
import { DEFAULT_SAVE_CHECK_SETTINGS, type SaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldInput } from '@/lib/weld-fields'

export function isLnkRepairForbiddenByDiameter(row: WeldInput) {
  const diameter = getMinimumJointDiameter(row)
  return diameter !== null && diameter < 89
}

export function isLnkRepairForbiddenByOfficialRepairLimit(row: WeldInput) {
  if (isUnofficialJoint(row)) return false
  const joint = String(row.joint ?? '').trim()
  if (!joint) return false
  return getRepeatedJointRepairCount(parseRepeatedJointName(joint)) >= 2
}

export function isLnkRepairForbidden(row: WeldInput) {
  return isLnkRepairForbiddenByDiameter(row) || isLnkRepairForbiddenByOfficialRepairLimit(row)
}

export function getLnkRepairForbiddenReason(row: WeldInput) {
  if (isLnkRepairForbiddenByDiameter(row)) return 'Диаметр до 89 мм'
  if (isLnkRepairForbiddenByOfficialRepairLimit(row)) return REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON
  return ''
}

export function getLnkResultRepairForbiddenSummary(rows: WeldInput[]) {
  const reasons = new Set(rows.map(getLnkRepairForbiddenReason).filter(Boolean))
  if (reasons.size === 0) return 'выбранные стыки не проходят правила ремонта'
  return [...reasons].join('; ')
}

export function assertNoLnkRepairRuleIssues(
  rows: WeldInput[],
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const issue = findFirstLnkRepairRuleIssue(rows, saveCheckSettings)
  if (issue) throw new Error(issue)
}

export function findFirstLnkRepairRuleIssue(
  rows: WeldInput[],
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.lnkResultRepairRules) return null

  for (const row of rows) {
    const repairMethods = LNK_METHODS.filter((method) => normalizeLnkResult(row[method.resultKey]) === 'ремонт')
    if (repairMethods.length === 0 || !isLnkRepairForbidden(row)) continue

    const methodCodes = repairMethods.map((method) => method.code).join(', ')
    if (isLnkRepairForbiddenByDiameter(row)) {
      return `результат ${methodCodes} - «ремонт» нельзя сохранить при D1/D2 ${formatJointDiameterLabel(row)} мм: для диаметра меньше 89 мм выберите «вырез» или исправьте D1/D2.`
    }

    return `результат ${methodCodes} - «ремонт» нельзя сохранить: ${getLnkRepairForbiddenReason(row)}.`
  }

  return null
}

export function getRowsWithChangedLnkRepairRuleInputs<T extends WeldInput & { id?: number }>(
  updatedRows: T[],
  previousRows: readonly (WeldInput & { id?: number })[],
) {
  const rowsById = new Map(previousRows.map((row) => [row.id, row]))
  return updatedRows.filter((row) => {
    const previousRow = rowsById.get(row.id)
    if (!previousRow) return true
    return (
      normalizeLnkRepairCompareValue(row.d1) !== normalizeLnkRepairCompareValue(previousRow.d1) ||
      normalizeLnkRepairCompareValue(row.d2) !== normalizeLnkRepairCompareValue(previousRow.d2) ||
      LNK_METHODS.some(
        (method) => normalizeLnkRepairCompareValue(row[method.resultKey]) !== normalizeLnkRepairCompareValue(previousRow[method.resultKey]),
      )
    )
  })
}

function normalizeLnkResult(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeLnkRepairCompareValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' ? value.trim() : value
}
