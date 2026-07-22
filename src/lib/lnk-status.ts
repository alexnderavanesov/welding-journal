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
  getCancelledLnkResultDisplay,
  getCancelledPstoResultDisplay,
  hasText,
  hasWeldDate,
  isCancelledControlValue,
  isEnabledControlValue,
  isPendingLnkResultValue,
  isYesText,
} from '@/lib/report-value-utils'
import { parseJointChainName } from '@/lib/joint-chain'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import { formatFinalStatusDisplay } from '@/lib/weld-status'
import { getDuplicateControls, getRejectedDuplicateControls } from '@/lib/duplicate-control-utils'

export type LnkMethod = (typeof LNK_METHODS)[number]

export function getLnkMethodByRequestKey(fieldKey: WeldFieldKey | '') {
  if (!fieldKey) return undefined
  return LNK_METHODS.find((method) => method.requestKey === fieldKey)
}

export function getLnkMethodByResultKey(fieldKey: WeldFieldKey | '') {
  if (!fieldKey) return undefined
  return LNK_METHODS.find((method) => method.resultKey === fieldKey)
}

export function isFinalLnkResultValue(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return LNK_RESULT_OPTIONS.includes(result as never) || result === 'годен (отменен)'
}

export function hasRejectedLnkResult(row: WeldInput) {
  if (getRejectedDuplicateControls(row).length > 0) return true
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

export function getAvailableLnkRequestMethods(row: WeldInput) {
  if (hasRejectedLnkResult(row)) return []
  return LNK_METHODS.filter((method) => isEnabledControlValue(row[method.enabledKey]) && !hasText(row[method.requestKey]))
}

export function isRejectedJoint(row: WeldInput) {
  const status = getJointStatusLabel(row)
  return status === 'не годен' || status === 'не годен по дублю'
}

export function formatLnkResultSummaryItems(row: WeldInput) {
  return LNK_METHODS.filter(
    (method) => hasText(row[method.requestKey]) || isEnabledControlValue(row[method.enabledKey]) || isCancelledControlValue(row[method.enabledKey]),
  ).map((method) => {
    const isCancelled = isCancelledControlValue(row[method.enabledKey])
    const result = isCancelled
      ? getCancelledLnkResultDisplay(row[method.resultKey])
      : isLnkMethodNoNeed(row, method)
      ? 'нет потребности'
      : getLnkEffectiveResultValue(row, method)
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
  if (method && isCancelledControlValue(row[method.enabledKey])) return getCancelledLnkResultDisplay(row[method.resultKey])
  if (method && isLnkMethodNoNeed(row, method)) return 'нет потребности'
  if (method) return getLnkEffectiveResultValue(row, method)
  return row[fieldKey]
}

export function getWeldingJournalDisplayValue(row: WeldInput, fieldKey: WeldFieldKey) {
  const method = getLnkMethodByResultKey(fieldKey)
  if (method) return getLnkDisplayValue(row, fieldKey)
  if (fieldKey === 'pstoResult') return getPstoDisplayValue(row, fieldKey)
  return row[fieldKey]
}

export function getPstoDisplayValue(row: WeldInput, fieldKey: WeldFieldKey) {
  if (fieldKey === 'pstoResult' && isPstoNoNeed(row)) return 'нет потребности'
  return row[fieldKey]
}

export function getLnkEffectiveResultValue(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  const result = String(row[method.resultKey] ?? '').trim()
  if (!isEnabledControlValue(row[method.enabledKey])) return result
  if (!result || isPendingLnkResultValue(result)) return hasText(row[method.requestKey]) ? 'ожидает НК' : 'ожидает заявку'
  return result
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
  if (status === 'не годен' || status === 'не годен по дублю') return status
  if (status === 'ожидает сварку') return 'ожидает сварку'
  if (status === 'ожидает ремонт') return 'ожидает ремонт'
  if (status === 'ожидает заявку') return 'ожидает заявку'
  if (status === 'ожидает нк') return 'ожидает НК'
  if (!hasWeldDate(row)) return getPendingWeldStatusLabel(row)
  if (hasAnyEnabledLnkControl(row) && !hasAnyLnkRequest(row)) return 'ожидает заявку'
  if (hasPendingLnkRequestResult(row)) return 'ожидает НК'
  return 'ожидает заявку'
}

export function getJointStatusDisplayLabel(row: WeldInput) {
  return formatFinalStatusDisplay(row, getJointStatusLabel(row))
}

export function getJointStatusBadgeClass(row: WeldInput) {
  const status = getJointStatusLabel(row)
  if (status === 'годен') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'не годен' || status === 'не годен по дублю') return 'border-rose-200 bg-rose-50 text-rose-800'
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

export function hasAnyEnabledLnkControl(row: WeldInput) {
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]))
}

export function hasAnyLnkRequest(row: WeldInput) {
  return LNK_METHODS.some((method) => hasText(row[method.requestKey]))
}

function isPstoNoNeed(row: WeldInput) {
  if (!isYesText(row.pstoRequired)) return false
  if (!isRejectedJoint(row)) return false
  const result = String(row.pstoResult ?? '').trim().toLowerCase()
  return result !== 'проведено' && result !== 'проведено (отменен)' && result !== 'отменен'
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
    isYesText(row.pstoRequired) ||
    isCancelledControlValue(row.pstoRequired) ||
    hasText(row.pstoRequest) ||
    hasText(row.pstoResult) ||
    hasText(row.heatTreatmentDiagram)
      ? [
          {
            label: 'ПСТО',
            value: isCancelledControlValue(row.pstoRequired)
              ? getCancelledPstoResultDisplay(row.pstoResult)
              : isRejectedJoint(row) && !hasText(row.pstoResult)
                ? 'нет потребности'
                : getPstoResultLabel(row.pstoResult),
            className: isCancelledControlValue(row.pstoRequired)
              ? getPstoResultBadgeClass(getCancelledPstoResultDisplay(row.pstoResult))
              : isRejectedJoint(row) && !hasText(row.pstoResult)
                ? getInactiveLnkRequestBadgeClass()
                : getPstoResultBadgeClass(row.pstoResult),
          },
        ]
      : []
  const duplicateItems = getDuplicateControls(row).map((control) => ({
    label: `${control.method} дубль`,
    value: control.result,
    className: getLnkResultBadgeClass(control.result),
  }))
  return [...lnkItems, ...duplicateItems, ...pstoItems]
}
