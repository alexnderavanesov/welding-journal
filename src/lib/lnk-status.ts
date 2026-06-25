import {
  LNK_METHODS,
  LNK_RESULT_OPTIONS,
} from '@/lib/report-config'
import {
  getInactiveLnkRequestBadgeClass,
  getLnkResultBadgeClass,
  getPstoResultBadgeClass,
  getPstoResultLabel,
} from '@/lib/report-badges'
import {
  hasText,
  hasWeldDate,
  isEnabledControlValue,
  isYesText,
} from '@/lib/report-value-utils'
import { parseJointChainName } from '@/lib/joint-chain'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export function getLnkMethodByRequestKey(fieldKey: WeldFieldKey) {
  return LNK_METHODS.find((method) => method.requestKey === fieldKey)
}

export function getLnkMethodByResultKey(fieldKey: WeldFieldKey) {
  return LNK_METHODS.find((method) => method.resultKey === fieldKey)
}

export function isFinalLnkResultValue(value: unknown) {
  return LNK_RESULT_OPTIONS.includes(String(value ?? '').trim().toLowerCase() as never)
}

export function hasRejectedLnkResult(row: WeldInput) {
  return LNK_METHODS.some((method) => {
    const result = String(row[method.resultKey] ?? '').trim().toLowerCase()
    return result === 'ремонт' || result === 'вырез'
  })
}

export function isLnkMethodNoNeed(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  if (!hasRejectedLnkResult(row)) return false
  if (isFinalLnkResultValue(row[method.resultKey])) return false
  return hasText(row[method.requestKey]) || isEnabledControlValue(row[method.enabledKey])
}

export function hasPendingLnkRequestResult(row: WeldInput) {
  return LNK_METHODS.some(
    (method) =>
      hasText(row[method.requestKey]) &&
      !isFinalLnkResultValue(row[method.resultKey]) &&
      !isLnkMethodNoNeed(row, method),
  )
}

export function isRejectedJoint(row: WeldInput) {
  return getJointStatusLabel(row) === 'не годен'
}

export function formatLnkResultSummaryItems(row: WeldInput) {
  return LNK_METHODS.filter((method) => hasText(row[method.requestKey]) || isEnabledControlValue(row[method.enabledKey])).map((method) => {
    const hasRequest = hasText(row[method.requestKey])
    const result = isLnkMethodNoNeed(row, method)
      ? 'нет потребности'
      : String(row[method.resultKey] ?? '').trim() || (hasRequest ? 'ожидает НК' : 'ожидает заявку')
    return {
      method: method.code,
      result,
      inactive: isLnkMethodNoNeed(row, method),
    }
  })
}

export function getLnkRequestMethodBadgeClass(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  if (isLnkMethodNoNeed(row, method)) {
    return getInactiveLnkRequestBadgeClass()
  }
  return getLnkResultBadgeClass(row[method.resultKey])
}

export function getLnkDisplayValue(row: WeldInput, fieldKey: WeldFieldKey) {
  const method = getLnkMethodByResultKey(fieldKey)
  if (method && isLnkMethodNoNeed(row, method)) return 'нет потребности'
  return row[fieldKey]
}

export function getPendingWeldStatusLabel(row: WeldInput) {
  const parsed = parseJointChainName(String(row.joint ?? ''))
  const hasCoilSegment = parsed.segments.some((segment) => segment.suffix === 'Y')
  const hasRepairSegment = parsed.segments.some((segment) => segment.suffix === 'R' || segment.suffix === 'W')
  return hasRepairSegment && !hasCoilSegment ? 'ожидает ремонт' : 'ожидает сварку'
}

export function getJointStatusLabel(row: WeldInput) {
  const status = String(row.finalStatus ?? '').trim().toLowerCase()
  if (status === 'годен') return 'годен'
  if (status === 'не годен') return 'не годен'
  if (status === 'ожидает сварку') return 'ожидает сварку'
  if (status === 'ожидает ремонт') return 'ожидает ремонт'
  if (status === 'ожидает заявку') return 'ожидает заявку'
  if (status === 'ожидает нк') return 'ожидает НК'
  if (!hasWeldDate(row)) return getPendingWeldStatusLabel(row)
  if (hasAnyEnabledLnkControl(row) && !hasAnyLnkRequest(row)) return 'ожидает заявку'
  if (hasPendingLnkRequestResult(row)) return 'ожидает НК'
  return 'ожидает заявку'
}

export function getJointStatusBadgeClass(row: WeldInput) {
  const status = getJointStatusLabel(row)
  if (status === 'годен') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'не годен') return 'border-rose-200 bg-rose-50 text-rose-800'
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

export function hasAnyEnabledLnkControl(row: WeldInput) {
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]))
}

export function hasAnyLnkRequest(row: WeldInput) {
  return LNK_METHODS.some((method) => hasText(row[method.requestKey]))
}

export function getJointChainResultItems(row: WeldInput) {
  const lnkItems = formatLnkResultSummaryItems(row)
    .filter((item) => item.result)
    .map((item) => ({
      label: item.method,
      value: item.result,
      className: item.inactive ? getInactiveLnkRequestBadgeClass() : getLnkResultBadgeClass(item.result),
    }))
  const pstoItems =
    isYesText(row.pstoRequired) || hasText(row.pstoRequest) || hasText(row.pstoResult) || hasText(row.heatTreatmentDiagram)
      ? [
          {
            label: 'ПСТО',
            value: isRejectedJoint(row) && !hasText(row.pstoResult) ? 'нет потребности' : getPstoResultLabel(row.pstoResult),
            className: isRejectedJoint(row) && !hasText(row.pstoResult) ? getInactiveLnkRequestBadgeClass() : getPstoResultBadgeClass(row.pstoResult),
          },
        ]
      : []
  return [...lnkItems, ...pstoItems]
}
