import type { WeldInput } from '@/lib/weld-fields'
import { formatDisplayDate, getDateInputValidationReason, parseDateLikeToIso } from '@/lib/date-format'
import { LNK_METHODS } from '@/lib/report-config'
import { getLnkMethodByRequestKey, isFinalLnkResultValue } from '@/lib/lnk-status'
import type { WeldFieldKey } from '@/lib/weld-fields'
import {
  DEFAULT_SAVE_CHECK_SETTINGS,
  formatSaveCheckBlockReason,
  type SaveCheckSettingId,
  type SaveCheckSettings,
} from '@/lib/save-check-settings'
import {
  getPreHeatTreatmentControl,
  getPreHeatTreatmentControls,
  isPreHeatTreatmentLnkMethodCode,
  PRE_HEAT_TREATMENT_LNK_METHODS,
} from '@/lib/lnk-control-stage'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import {
  getCurrentPstoCycle,
  getPstoTvmtWorkflowState,
  requiresPostHeatTreatmentCompletion,
} from '@/lib/tvmt-cycle'
import { getDuplicateControls } from '@/lib/duplicate-control-utils'

type LnkChronologyRow = WeldInput & { id?: number }

export const LNK_REQUEST_DATE_ORDER_REASON = 'проверить даты ЛНК'
export const LNK_VIK_DATE_ORDER_REASON = 'проверить порядок ВИК и НК'
export const LNK_VIK_REQUIRED_REASON = 'дозаполнить ВИК перед другим НК'

export function isLnkChronologyCheckReason(reason?: string) {
  return (
    reason === LNK_REQUEST_DATE_ORDER_REASON ||
    reason === LNK_VIK_DATE_ORDER_REASON ||
    reason === LNK_VIK_REQUIRED_REASON
  )
}

export type LnkChronologyIssueKind =
  | 'request-date-missing'
  | 'request-date-invalid'
  | 'request-name-missing'
  | 'conclusion-date-invalid'
  | 'weld-after-request'
  | 'weld-after-conclusion'
  | 'request-after-conclusion'
  | 'pre-after-psto'
  | 'post-before-psto-cycle'
  | 'post-before-psto'
  | 'post-before-tvmt'
  | 'vik-missing-before-other'
  | 'vik-after-other'

export type LnkChronologyIssue = {
  kind: LnkChronologyIssueKind
  methodCode: string
  controlStage: 'primary' | 'beforeHeatTreatment' | 'duplicate'
  documentPart: 'request' | 'conclusion' | 'result'
  relationId?: number
  reason: string
  message: string
  row: LnkChronologyRow
}

type LnkChronologyOptions = {
  includeConclusionBeforeWeldIssue?: boolean
  includeInvalidDateIssues?: boolean
  includeRequestIntegrityIssues?: boolean
}

export function getLnkChronologyIssues(
  rows: LnkChronologyRow[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  options: LnkChronologyOptions = {},
): LnkChronologyIssue[] {
  const issues: LnkChronologyIssue[] = []
  for (const row of rows) {
    issues.push(...getRowRequestDateOrderIssues(row, settings, options))
    issues.push(...getRowPreHeatTreatmentDateOrderIssues(row, settings, options))
    issues.push(...getRowPostHeatTreatmentDateOrderIssues(row, settings))
    issues.push(...getRowVikOrderIssues(row, settings))
    issues.push(...getRowPreHeatTreatmentVikOrderIssues(row, settings))
    if (options.includeInvalidDateIssues) issues.push(...getRowDuplicateDateIssues(row))
  }
  return issues
}

function getRowPreHeatTreatmentDateOrderIssues(
  row: LnkChronologyRow,
  settings: SaveCheckSettings,
  options: LnkChronologyOptions,
) {
  if (
    !settings.lnkResultRequestDateOrder &&
    !settings.lnkResultDateAfterWeldDate &&
    !options.includeConclusionBeforeWeldIssue &&
    !options.includeInvalidDateIssues &&
    !options.includeRequestIntegrityIssues
  ) return []
  const issues: LnkChronologyIssue[] = []
  const weldDate = parseDateLikeToIso(row.weldDate)
  const pstoDate = parseDateLikeToIso(row.pstoDate)
  const joint = formatJoint(row)

  for (const control of getPreHeatTreatmentControls(row)) {
    if (!isPreHeatTreatmentLnkMethodCode(control.method)) continue
    const methodCode = `${control.method} до ТО`
    const requestName = String(control.requestName ?? '').trim()
    const rawRequestDate = String(control.requestDate ?? '').trim()
    const hasRequestDate = hasDateInputValue(control.requestDate)
    const requestDate = parseDateLikeToIso(control.requestDate)
    const rawConclusionDate = String(control.conclusionDate ?? '').trim()
    const hasConclusionDate = hasDateInputValue(control.conclusionDate)
    const conclusionDate = parseDateLikeToIso(control.conclusionDate)
    const hasConclusion = isFinalResult(control.result)
    const hasTrace = Boolean(
      requestName || rawRequestDate || hasConclusion ||
      String(control.conclusionDate ?? '').trim() || String(control.conclusionName ?? '').trim(),
    )

    const requestDateReason = getDateInputValidationReason(control.requestDate, `Дата заявки ${methodCode}`)
    const conclusionDateReason = getDateInputValidationReason(control.conclusionDate, `Дата заключения ${methodCode}`)
    if (options.includeInvalidDateIssues && requestDateReason) {
      issues.push({
        kind: 'request-date-invalid',
        methodCode,
        controlStage: 'beforeHeatTreatment',
        documentPart: 'request',
        relationId: control.id,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: ${requestDateReason}`,
      })
    } else if (options.includeRequestIntegrityIssues && hasTrace && !hasRequestDate) {
      issues.push({
        kind: 'request-date-missing',
        methodCode,
        controlStage: 'beforeHeatTreatment',
        documentPart: 'request',
        relationId: control.id,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: у ${methodCode} есть данные контроля, но нет даты заявки ЛНК.`,
      })
    }
    if (options.includeInvalidDateIssues && hasConclusionDate && conclusionDateReason) {
      issues.push({
        kind: 'conclusion-date-invalid',
        methodCode,
        controlStage: 'beforeHeatTreatment',
        documentPart: 'conclusion',
        relationId: control.id,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: ${conclusionDateReason}`,
      })
    }
    if (options.includeRequestIntegrityIssues && hasTrace && !requestName) {
      issues.push({
        kind: 'request-name-missing',
        methodCode,
        controlStage: 'beforeHeatTreatment',
        documentPart: 'request',
        relationId: control.id,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: у ${methodCode} есть данные контроля, но нет наименования заявки ЛНК.`,
      })
    }
    if (settings.lnkResultRequestDateOrder && requestDate && weldDate && requestDate < weldDate) {
      issues.push({
        kind: 'weld-after-request',
        methodCode,
        controlStage: 'beforeHeatTreatment',
        documentPart: 'request',
        relationId: control.id,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата заявки ${methodCode} ${formatDisplayDate(requestDate)} раньше даты сварки ${formatDisplayDate(weldDate)}.`,
      })
    }
    if (
      (settings.lnkResultDateAfterWeldDate || options.includeConclusionBeforeWeldIssue) &&
      hasConclusion &&
      conclusionDate &&
      weldDate &&
      conclusionDate < weldDate
    ) {
      issues.push({
        kind: 'weld-after-conclusion',
        methodCode,
        controlStage: 'beforeHeatTreatment',
        documentPart: 'conclusion',
        relationId: control.id,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата заключения ${methodCode} ${formatDisplayDate(conclusionDate)} раньше даты сварки ${formatDisplayDate(weldDate)}.`,
      })
    }
    if (settings.lnkResultRequestDateOrder && requestDate && conclusionDate && conclusionDate < requestDate) {
      issues.push({
        kind: 'request-after-conclusion',
        methodCode,
        controlStage: 'beforeHeatTreatment',
        documentPart: 'conclusion',
        relationId: control.id,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата заключения ${methodCode} ${formatDisplayDate(conclusionDate)} раньше даты заявки ${formatDisplayDate(requestDate)}.`,
      })
    }
    if (!settings.lnkResultRequestDateOrder) continue
    for (const [label, documentPart, date] of [
      ['заявки', 'request', requestDate],
      ['заключения', 'conclusion', conclusionDate],
    ] as const) {
      if (!date || !pstoDate || date <= pstoDate) continue
      issues.push({
        kind: 'pre-after-psto',
        methodCode,
        controlStage: 'beforeHeatTreatment',
        documentPart,
        relationId: control.id,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата ${label} ${methodCode} ${formatDisplayDate(date)} позже даты ПСТО ${formatDisplayDate(pstoDate)}.`,
      })
    }
  }
  return issues
}

function getRowPostHeatTreatmentDateOrderIssues(
  row: LnkChronologyRow,
  settings: SaveCheckSettings,
) {
  if (!settings.lnkResultRequestDateOrder || !requiresPostHeatTreatmentCompletion(row)) return []
  const issues: LnkChronologyIssue[] = []
  const joint = formatJoint(row)
  const cycle = getCurrentPstoCycle(row)
  const pstoDate = parseDateLikeToIso(cycle?.pstoDate)
  const tvmtDate = parseDateLikeToIso(cycle?.tvmtConclusionDate)
  const cycleComplete = getPstoTvmtWorkflowState(row) === 'complete'

  for (const method of LNK_METHODS) {
    if (!isPreHeatTreatmentLnkMethodCode(method.code)) continue
    const requestDate = parseDateLikeToIso(row[method.requestDateKey])
    const conclusionDate = parseDateLikeToIso(row[method.conclusionDateKey])
    const hasTrace = Boolean(
      String(row[method.requestKey] ?? '').trim() ||
      requestDate ||
      isFinalLnkResultValue(row[method.resultKey]) ||
      conclusionDate,
    )
    if (!hasTrace) continue
    if (!cycleComplete) {
      issues.push({
        kind: 'post-before-psto-cycle',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart: 'request',
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: ${method.code} после ТО оформлен до завершения цикла ПСТО и ТВМТ.`,
      })
      continue
    }
    for (const [kind, label, documentPart, date] of [
      ['post-before-psto', 'заявки', 'request', requestDate],
      ['post-before-psto', 'заключения', 'conclusion', conclusionDate],
    ] as const) {
      if (!date || !pstoDate || date >= pstoDate) continue
      issues.push({
        kind,
        methodCode: method.code,
        controlStage: 'primary',
        documentPart,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата ${label} ${method.code} после ТО ${formatDisplayDate(date)} раньше даты ПСТО ${formatDisplayDate(pstoDate)}.`,
      })
    }
    for (const [label, documentPart, date] of [
      ['заявки', 'request', requestDate],
      ['заключения', 'conclusion', conclusionDate],
    ] as const) {
      if (!date || !tvmtDate || date >= tvmtDate) continue
      issues.push({
        kind: 'post-before-tvmt',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата ${label} ${method.code} после ТО ${formatDisplayDate(date)} раньше ТВМТ, завершившей цикл, ${formatDisplayDate(tvmtDate)}.`,
      })
    }
  }
  return issues
}

function getRowPreHeatTreatmentVikOrderIssues(
  row: LnkChronologyRow,
  settings: SaveCheckSettings,
) {
  const issues: LnkChronologyIssue[] = []
  const vik = getPreHeatTreatmentControl(row, 'ВИК')
  const vikDate = parseDateLikeToIso(vik?.conclusionDate)
  const vikGood = String(vik?.result ?? '').trim().toLocaleLowerCase('ru-RU') === 'годен'
  const joint = formatJoint(row)
  for (const method of PRE_HEAT_TREATMENT_LNK_METHODS.slice(1)) {
    const control = getPreHeatTreatmentControl(row, method.code)
    if (!control || !isFinalResult(control.result)) continue
    if (settings.lnkResultVikRequiredBeforeOther && !vikGood) {
      issues.push({
        kind: 'vik-missing-before-other',
        methodCode: `${method.code} до ТО`,
        controlStage: 'beforeHeatTreatment',
        documentPart: 'result',
        relationId: control.id,
        reason: LNK_VIK_REQUIRED_REASON,
        row,
        message: `Стык ${joint}: нельзя сохранять результат ${method.code} до ТО, пока нет годного результата ВИК до ТО.`,
      })
      continue
    }
    const conclusionDate = parseDateLikeToIso(control.conclusionDate)
    if (settings.lnkResultVikDateBeforeOther && vikDate && conclusionDate && conclusionDate < vikDate) {
      issues.push({
        kind: 'vik-after-other',
        methodCode: `${method.code} до ТО`,
        controlStage: 'beforeHeatTreatment',
        documentPart: 'conclusion',
        relationId: control.id,
        reason: LNK_VIK_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата ${method.code} до ТО ${formatDisplayDate(conclusionDate)} раньше даты ВИК до ТО ${formatDisplayDate(vikDate)}.`,
      })
    }
  }
  return issues
}

export function findFirstLnkChronologyIssue(rows: WeldInput[], settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS) {
  return getLnkChronologyIssues(rows, settings)[0]?.message ?? ''
}

export function findFirstLnkChronologySaveBlockReason(rows: WeldInput[], settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS) {
  const issue = getLnkChronologyIssues(rows, settings)[0]
  return issue ? formatLnkChronologyIssueSaveBlockReason(issue) : ''
}

export function findFirstNewLnkChronologySaveBlockReason(
  rows: WeldInput[],
  previousRows: WeldInput[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const previousIssueKeys = new Set(
    getLnkChronologyIssues(previousRows, settings).map(getLnkChronologyIssueIdentity),
  )
  const issue = getLnkChronologyIssues(rows, settings)
    .find((candidate) => !previousIssueKeys.has(getLnkChronologyIssueIdentity(candidate)))
  return issue ? formatLnkChronologyIssueSaveBlockReason(issue) : ''
}

export function assertNoLnkChronologyIssues(rows: WeldInput[], settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS) {
  const issue = findFirstLnkChronologySaveBlockReason(rows, settings)
  if (issue) throw new Error(issue)
}

export function assertNoNewLnkChronologyIssues(
  rows: WeldInput[],
  previousRows: WeldInput[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const issue = findFirstNewLnkChronologySaveBlockReason(rows, previousRows, settings)
  if (issue) throw new Error(issue)
}

export function getLnkResultRemovalBlockReason(
  row: WeldInput,
  methodKey: WeldFieldKey,
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const method = getLnkMethodByRequestKey(methodKey)
  if (method?.code !== 'ВИК' || !settings.lnkResultVikRequiredBeforeOther) return ''

  const dependentMethods = LNK_METHODS.slice(1)
    .filter((candidate) => hasFinalLnkResult(row, candidate))
    .map((candidate) => candidate.code)

  if (dependentMethods.length === 0) return ''
  return `Результат ВИК нельзя удалить, пока сохранены результаты следующих видов НК: ${dependentMethods.join(', ')}. Сначала удалите их результаты.`
}

function getLnkChronologyIssueSaveCheckSettingId(issue: LnkChronologyIssue): SaveCheckSettingId {
  if (issue.reason === LNK_VIK_DATE_ORDER_REASON) return 'lnkResultVikDateBeforeOther'
  if (issue.reason === LNK_VIK_REQUIRED_REASON) return 'lnkResultVikRequiredBeforeOther'
  if (issue.kind === 'weld-after-conclusion') return 'lnkResultDateAfterWeldDate'
  return 'lnkResultRequestDateOrder'
}

function formatLnkChronologyIssueSaveBlockReason(issue: LnkChronologyIssue) {
  return formatSaveCheckBlockReason(getLnkChronologyIssueSaveCheckSettingId(issue), issue.message)
}

function getLnkChronologyIssueIdentity(issue: LnkChronologyIssue) {
  return `${issue.kind}\u0000${issue.methodCode}\u0000${issue.message}`
}

export function getDispatcherLnkChronologyIssues(rows: LnkChronologyRow[]) {
  return getLnkChronologyIssues(rows, {
    ...DEFAULT_SAVE_CHECK_SETTINGS,
    lnkResultRequestDateOrder: true,
    lnkResultVikDateBeforeOther: true,
    lnkResultVikRequiredBeforeOther: true,
  }, {
    includeConclusionBeforeWeldIssue: true,
    includeInvalidDateIssues: true,
    includeRequestIntegrityIssues: true,
  })
}

function getRowRequestDateOrderIssues(
  row: LnkChronologyRow,
  settings: SaveCheckSettings,
  options: LnkChronologyOptions,
) {
  if (
    !settings.lnkResultRequestDateOrder &&
    !settings.lnkResultDateAfterWeldDate &&
    !options.includeConclusionBeforeWeldIssue &&
    !options.includeInvalidDateIssues &&
    !options.includeRequestIntegrityIssues
  ) return []
  const issues: LnkChronologyIssue[] = []
  for (const method of LNK_METHODS) {
    const requestName = String(row[method.requestKey] ?? '').trim()
    const rawRequestDate = String(row[method.requestDateKey] ?? '').trim()
    const hasRequestDate = hasDateInputValue(row[method.requestDateKey])
    const requestDate = parseDateLikeToIso(row[method.requestDateKey])
    const weldDate = parseDateLikeToIso(row.weldDate)
    const rawConclusionDate = String(row[method.conclusionDateKey] ?? '').trim()
    const hasConclusionDate = hasDateInputValue(row[method.conclusionDateKey])
    const conclusionDate = parseDateLikeToIso(row[method.conclusionDateKey])
    const hasConclusion = hasFinalLnkResult(row, method)
    const hasRequestTrace = Boolean(
      requestName || rawRequestDate || hasConclusion ||
      String(row[method.conclusionDateKey] ?? '').trim() || String(row[method.conclusionKey] ?? '').trim(),
    )
    if (!hasRequestTrace) continue

    const joint = formatJoint(row)
    const requestDateReason = getDateInputValidationReason(row[method.requestDateKey], `Дата заявки ${method.code}`)
    const conclusionDateReason = getDateInputValidationReason(row[method.conclusionDateKey], `Дата заключения ${method.code}`)
    if (options.includeInvalidDateIssues && requestDateReason) {
      issues.push({
        kind: 'request-date-invalid',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart: 'request',
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: ${requestDateReason}`,
      })
    } else if (options.includeRequestIntegrityIssues && !hasRequestDate) {
      issues.push({
        kind: 'request-date-missing',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart: 'request',
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: у ${method.code} есть данные контроля, но нет даты заявки ЛНК.`,
      })
    }
    if (options.includeInvalidDateIssues && hasConclusionDate && conclusionDateReason) {
      issues.push({
        kind: 'conclusion-date-invalid',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart: 'conclusion',
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: ${conclusionDateReason}`,
      })
    }
    if (options.includeRequestIntegrityIssues && !requestName) {
      issues.push({
        kind: 'request-name-missing',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart: 'request',
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: у ${method.code} есть данные контроля, но нет наименования заявки ЛНК.`,
      })
    }

    if (settings.lnkResultRequestDateOrder && requestDate && weldDate && requestDate < weldDate) {
      issues.push({
        kind: 'weld-after-request',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart: 'request',
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата заявки ${method.code} ${formatDisplayDate(requestDate)} раньше даты сварки ${formatDisplayDate(weldDate)}.`,
      })
    }

    if (
      (settings.lnkResultDateAfterWeldDate || options.includeConclusionBeforeWeldIssue) &&
      hasConclusion &&
      conclusionDate &&
      weldDate &&
      conclusionDate < weldDate
    ) {
      issues.push({
        kind: 'weld-after-conclusion',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart: 'conclusion',
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата заключения ${method.code} ${formatDisplayDate(conclusionDate)} раньше даты сварки ${formatDisplayDate(weldDate)}.`,
      })
    }

    if (settings.lnkResultRequestDateOrder && requestDate && conclusionDate && conclusionDate < requestDate) {
      issues.push({
        kind: 'request-after-conclusion',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart: 'conclusion',
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата заключения ${method.code} ${formatDisplayDate(conclusionDate)} раньше даты заявки ${formatDisplayDate(requestDate)}.`,
      })
    }
  }
  return issues
}

function getRowDuplicateDateIssues(row: LnkChronologyRow): LnkChronologyIssue[] {
  const joint = formatJoint(row)
  return getDuplicateControls(row).flatMap((control) => {
    const methodCode = `${control.method} (дубль)`
    return [
      { kind: 'request-date-invalid' as const, documentPart: 'request' as const, label: 'Дата контроля', value: control.controlDate },
      { kind: 'conclusion-date-invalid' as const, documentPart: 'conclusion' as const, label: 'Дата заключения', value: control.conclusionDate },
    ].flatMap(({ kind, documentPart, label, value }) => {
      const dateReason = getDateInputValidationReason(value, `${label} ${methodCode}`)
      return dateReason
        ? [{
            kind,
            methodCode,
            controlStage: 'duplicate' as const,
            documentPart,
            relationId: control.id,
            reason: LNK_REQUEST_DATE_ORDER_REASON,
            row,
            message: `Стык ${joint}: ${dateReason}`,
          }]
        : []
    })
  })
}

function getRowVikOrderIssues(row: LnkChronologyRow, settings: SaveCheckSettings) {
  const vikMethod = LNK_METHODS[0]
  if (!vikMethod) return []
  const issues: LnkChronologyIssue[] = []
  const vikConclusionDate = parseDateLikeToIso(row[vikMethod.conclusionDateKey])
  const hasVikResult = hasFinalLnkResult(row, vikMethod)
  const joint = formatJoint(row)

  for (const method of LNK_METHODS.slice(1)) {
    if (!hasFinalLnkResult(row, method)) continue

    if (settings.lnkResultVikRequiredBeforeOther && !hasVikResult) {
      issues.push({
        kind: 'vik-missing-before-other',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart: 'result',
        reason: LNK_VIK_REQUIRED_REASON,
        row,
        message: `Стык ${joint}: нельзя сохранять результат ${method.code}, пока нет результата ВИК.`,
      })
      continue
    }

    const conclusionDate = parseDateLikeToIso(row[method.conclusionDateKey])
    if (settings.lnkResultVikDateBeforeOther && vikConclusionDate && conclusionDate && conclusionDate < vikConclusionDate) {
      issues.push({
        kind: 'vik-after-other',
        methodCode: method.code,
        controlStage: 'primary',
        documentPart: 'conclusion',
        reason: LNK_VIK_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата ${method.code} ${formatDisplayDate(conclusionDate)} раньше даты ВИК ${formatDisplayDate(vikConclusionDate)}.`,
      })
    }
  }
  return issues
}

function hasFinalLnkResult(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  return isFinalLnkResultValue(row[method.resultKey])
}

function isFinalResult(value: unknown) {
  const result = String(value ?? '').trim().toLocaleLowerCase('ru-RU')
  return result === 'годен' || result === 'ремонт' || result === 'вырез'
}

function hasDateInputValue(value: unknown) {
  const text = String(value ?? '').trim()
  return Boolean(text && text !== '-')
}

function formatJoint(row: LnkChronologyRow) {
  return String(row.joint ?? '').trim() || `ID ${String(row.id ?? '-')}`
}
