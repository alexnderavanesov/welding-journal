import {
  LNK_METHODS,
  LNK_RESULT_OPTIONS,
} from '@/lib/report-config'
import {
  getInactiveLnkRequestBadgeClass,
  getLnkResultBadgeClass,
  getPstoResultBadgeClass,
} from '@/lib/report-badges'
import {
  getCancelledLnkResultDisplay,
  hasText,
  hasWeldDate,
  isCancelledControlValue,
  isEnabledControlValue,
  isPendingLnkResultValue,
  isYesText,
} from '@/lib/report-value-utils'
import { parseJointChainName } from '@/lib/joint-chain'
import { loadOtherSettings } from '@/lib/other-settings'
import { getRkExposureSchemeState } from '@/lib/rk-exposure'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import { formatFinalStatusDisplay } from '@/lib/weld-status'
import { getDuplicateControls, getRejectedDuplicateControls } from '@/lib/duplicate-control-utils'
import { CONTROL_BASIS_SUMMARY_FIELD_KEY, formatControlBasisSummary } from '@/lib/control-assignment-basis'
import {
  getRejectedPreHeatTreatmentControls,
  getPrimaryPstoStartStatusLabel,
  isPrimaryLnkStageReady,
} from '@/lib/lnk-control-stage'
import { getPreHeatTreatmentReportValue } from '@/lib/pre-heat-treatment-report-fields'
import {
  getCurrentPstoCycle,
  getPstoCycleSummary,
  getPstoTvmtWorkflowLabel,
  getPstoTvmtWorkflowState,
  normalizeTvmtResult,
} from '@/lib/tvmt-cycle'
import {
  getLnkDefectDescriptionDescriptor,
  getLnkDefectDescriptionDisplayValue,
} from '@/lib/lnk-defect-description'

export type LnkMethod = (typeof LNK_METHODS)[number]

const LNK_METHOD_BY_REQUEST_KEY = new Map<WeldFieldKey, LnkMethod>(
  LNK_METHODS.map((method) => [method.requestKey, method]),
)
const LNK_METHOD_BY_RESULT_KEY = new Map<WeldFieldKey, LnkMethod>(
  LNK_METHODS.map((method) => [method.resultKey, method]),
)

export function getLnkMethodByRequestKey(fieldKey: WeldFieldKey | '') {
  if (!fieldKey) return undefined
  return LNK_METHOD_BY_REQUEST_KEY.get(fieldKey)
}

export function getLnkMethodByResultKey(fieldKey: WeldFieldKey | '') {
  if (!fieldKey) return undefined
  return LNK_METHOD_BY_RESULT_KEY.get(fieldKey)
}

export function isFinalLnkResultValue(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return LNK_RESULT_OPTIONS.includes(result as never) || result === 'годен (отменен)'
}

export function hasRejectedLnkResult(row: WeldInput) {
  if (getRejectedDuplicateControls(row).length > 0) return true
  if (getRejectedPreHeatTreatmentControls(row).length > 0) return true
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
  return LNK_METHODS.filter((method) =>
    isEnabledControlValue(row[method.enabledKey]) &&
    !hasText(row[method.requestKey]) &&
    isPrimaryLnkStageReady(row, method.code),
  )
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
  const defectDescriptor = getLnkDefectDescriptionDescriptor(fieldKey)
  if (defectDescriptor) return getLnkDefectDescriptionDisplayValue(row, defectDescriptor)
  const preHeatTreatmentValue = getPreHeatTreatmentReportValue(row, fieldKey)
  if (preHeatTreatmentValue !== undefined) return preHeatTreatmentValue
  if (fieldKey === CONTROL_BASIS_SUMMARY_FIELD_KEY) return formatControlBasisSummary(row, 'lnk')
  if (fieldKey === 'rkExposureScheme') {
    return getRkExposureSchemeState(row, loadOtherSettings().rkExposureTable).label
  }
  const method = getLnkMethodByResultKey(fieldKey)
  if (method && isCancelledControlValue(row[method.enabledKey])) return getCancelledLnkResultDisplay(row[method.resultKey])
  if (method && isLnkMethodNoNeed(row, method)) return 'нет потребности'
  if (method) return getLnkEffectiveResultValue(row, method)
  return row[fieldKey]
}

export function getWeldingJournalDisplayValue(row: WeldInput, fieldKey: WeldFieldKey) {
  if (fieldKey === CONTROL_BASIS_SUMMARY_FIELD_KEY) return formatControlBasisSummary(row, 'all')
  const method = getLnkMethodByResultKey(fieldKey)
  if (method) return getLnkDisplayValue(row, fieldKey)
  if (fieldKey === 'pstoResult') return getPstoDisplayValue(row, fieldKey)
  return row[fieldKey]
}

export function getPstoDisplayValue(row: WeldInput, fieldKey: WeldFieldKey) {
  if (fieldKey === CONTROL_BASIS_SUMMARY_FIELD_KEY) return formatControlBasisSummary(row, 'psto')
  if (fieldKey === 'pstoControlBasis' || fieldKey === 'pstoCancellationDate') {
    return isCancelledControlValue(row.pstoRequired) ? row[fieldKey] : ''
  }
  if (fieldKey === 'pstoCycleSummary') {
    return getPstoCycleDisplaySummary(row)
  }
  const currentCycle = getCurrentPstoCycle(row)
  const cycleValue = currentCycle && PSTO_CYCLE_REPORT_FIELD_KEYS.has(fieldKey)
    ? currentCycle[fieldKey as PstoCycleReportFieldKey]
    : undefined
  if (fieldKey === 'pstoResult' && isPstoNoNeed(row, cycleValue)) return 'нет потребности'
  if (cycleValue !== undefined) return cycleValue
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

const PSTO_CYCLE_REPORT_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'heatTreatmentDiagram',
  'pstoResult',
  'pstoNote',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtResult',
  'tvmtConclusionDate',
  'tvmtConclusion',
])

type PstoCycleReportFieldKey =
  | 'pstoRequest'
  | 'pstoRequestDate'
  | 'pstoDate'
  | 'heatTreatmentDiagram'
  | 'pstoResult'
  | 'pstoNote'
  | 'tvmtRequest'
  | 'tvmtRequestDate'
  | 'tvmtResult'
  | 'tvmtConclusionDate'
  | 'tvmtConclusion'

export function getPstoCycleDisplaySummary(row: WeldInput) {
  const currentCycle = getCurrentPstoCycle(row)
  if (isPstoNoNeed(row, currentCycle?.pstoResult)) return 'нет потребности'
  return getPstoCycleSummary(row, getPrimaryPstoStartStatusLabel(row))
}

export function isPstoNoNeed(row: WeldInput, resultValue: unknown = row.pstoResult) {
  if (!isYesText(row.pstoRequired)) return false
  if (!hasRejectedLnkResult(row) && !isRejectedJoint(row)) return false
  const result = String(resultValue ?? '').trim().toLowerCase()
  return result !== 'проведено' && result !== 'проведено (отменен)' && result !== 'отменен'
}

export type JointChainResultItem = {
  stage: 'pstoTvmt' | 'mainLnk' | 'duplicate'
  label: string
  value: string
  className: string
}

export function getJointChainResultItems(row: WeldInput): JointChainResultItem[] {
  const lnkItems = formatLnkResultSummaryItems(row)
    .filter((item) => item.result)
    .map((item) => ({
      stage: 'mainLnk' as const,
      label: item.method,
      value: item.result,
      className: item.inactive ? getInactiveLnkRequestBadgeClass() : getLnkResultBadgeClass(item.result),
    }))
  const pstoItems = getJointChainPstoTvmtItems(row)
  const duplicateItems = getDuplicateControls(row).map((control) => ({
    stage: 'duplicate' as const,
    label: `${control.method} дубль`,
    value: control.result,
    className: getLnkResultBadgeClass(control.result),
  }))
  return [...pstoItems, ...lnkItems, ...duplicateItems]
}

function getJointChainPstoTvmtItems(row: WeldInput): JointChainResultItem[] {
  const currentCycle = getCurrentPstoCycle(row)
  const workflowState = getPstoTvmtWorkflowState(row)
  const sequence = currentCycle?.sequence ?? 1
  const tvmtResult = normalizeTvmtResult(currentCycle?.tvmtResult)
  const cancelled = isCancelledControlValue(row.pstoRequired)
  const hasPstoStage = isYesText(row.pstoRequired)
    || cancelled
    || currentCycle !== null
  if (!hasPstoStage) return []

  const cancellationItem: JointChainResultItem = {
    stage: 'pstoTvmt',
    label: 'Линия ПСТО',
    value: 'отменена',
    className: getPstoResultBadgeClass('отменен'),
  }

  if (cancelled && workflowState === 'not-required') {
    return [cancellationItem]
  }

  if (cancelled && workflowState === 'complete' && tvmtResult === 'failed') {
    return [
      cancellationItem,
      {
        stage: 'pstoTvmt',
        label: `ТВМТ · цикл ${sequence}`,
        value: 'не годен',
        className: 'border-rose-200 bg-rose-50 text-rose-800',
      },
    ]
  }

  if (cancelled && workflowState !== 'complete') {
    return [
      cancellationItem,
      {
        stage: 'pstoTvmt',
        label: `Цикл ${sequence}`,
        value: getPstoTvmtWorkflowLabel(workflowState),
        className: getPstoResultBadgeClass('ожидает'),
      },
    ]
  }

  if (workflowState === 'complete' && tvmtResult === 'good') {
    return [
      ...(cancelled ? [cancellationItem] : []),
      {
        stage: 'pstoTvmt',
        label: 'ПСТО',
        value: 'проведено',
        className: getPstoResultBadgeClass('проведено'),
      },
      {
        stage: 'pstoTvmt',
        label: 'ТВМТ',
        value: 'годен',
        className: getLnkResultBadgeClass('годен'),
      },
    ]
  }

  if (isPstoNoNeed(row, currentCycle?.pstoResult)) {
    return [{
      stage: 'pstoTvmt',
      label: `Цикл ${sequence}`,
      value: 'нет потребности',
      className: getInactiveLnkRequestBadgeClass(),
    }]
  }

  if (workflowState === 'repeat-psto-required') {
    return [
      {
        stage: 'pstoTvmt',
        label: `ТВМТ · цикл ${sequence}`,
        value: 'не годен',
        className: 'border-rose-200 bg-rose-50 text-rose-800',
      },
      {
        stage: 'pstoTvmt',
        label: 'ПСТО',
        value: `требуется цикл ${sequence + 1}`,
        className: getPstoResultBadgeClass('ожидает'),
      },
    ]
  }

  if (workflowState === 'not-required') {
    return [{
      stage: 'pstoTvmt',
      label: 'ПСТО',
      value: 'не требуется',
      className: getInactiveLnkRequestBadgeClass(),
    }]
  }

  return [{
    stage: 'pstoTvmt',
    label: `Цикл ${sequence}`,
    value: getPstoTvmtWorkflowLabel(workflowState),
    className: getPstoResultBadgeClass('ожидает'),
  }]
}
