import { getRepeatedJointRepairCount, parseRepeatedJointName } from '@/lib/joint-chain'
import { getMinimumJointDiameter, isUnofficialJoint } from '@/lib/joint-display'
import { REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON } from '@/lib/report-config'
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
