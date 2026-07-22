import type { WeldInput } from '@/lib/weld-fields'
import { formatDisplayDate, parseDateLikeToIso } from '@/lib/date-format'
import { LNK_METHODS } from '@/lib/report-config'
import { isFinalLnkResultValue } from '@/lib/lnk-status'
import { DEFAULT_SAVE_CHECK_SETTINGS, type SaveCheckSettings } from '@/lib/save-check-settings'

type LnkChronologyRow = WeldInput & { id?: number }

export const LNK_REQUEST_DATE_ORDER_REASON = 'проверить даты заявки ЛНК'
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
  | 'weld-after-request'
  | 'request-after-conclusion'
  | 'vik-missing-before-other'
  | 'vik-after-other'

export type LnkChronologyIssue = {
  kind: LnkChronologyIssueKind
  methodCode: string
  reason: string
  message: string
  row: LnkChronologyRow
}

type LnkChronologyOptions = {
  includeMissingRequestDateIssue?: boolean
}

export function getLnkChronologyIssues(
  rows: LnkChronologyRow[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  options: LnkChronologyOptions = {},
): LnkChronologyIssue[] {
  const issues: LnkChronologyIssue[] = []
  for (const row of rows) {
    issues.push(...getRowRequestDateOrderIssues(row, settings, options))
    issues.push(...getRowVikOrderIssues(row, settings))
  }
  return issues
}

export function findFirstLnkChronologyIssue(rows: WeldInput[], settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS) {
  return getLnkChronologyIssues(rows, settings)[0]?.message ?? ''
}

export function assertNoLnkChronologyIssues(rows: WeldInput[], settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS) {
  const issue = findFirstLnkChronologyIssue(rows, settings)
  if (issue) throw new Error(issue)
}

export function getDispatcherLnkChronologyIssues(rows: LnkChronologyRow[]) {
  return getLnkChronologyIssues(rows, {
    ...DEFAULT_SAVE_CHECK_SETTINGS,
    lnkResultRequestDateOrder: true,
    lnkResultVikDateBeforeOther: true,
    lnkResultVikRequiredBeforeOther: true,
  }, {
    includeMissingRequestDateIssue: true,
  })
}

function getRowRequestDateOrderIssues(
  row: LnkChronologyRow,
  settings: SaveCheckSettings,
  options: LnkChronologyOptions,
) {
  if (!settings.lnkResultRequestDateOrder) return []
  const issues: LnkChronologyIssue[] = []
  for (const method of LNK_METHODS) {
    const requestName = String(row[method.requestKey] ?? '').trim()
    const requestDate = parseDateLikeToIso(row[method.requestDateKey])
    const weldDate = parseDateLikeToIso(row.weldDate)
    const conclusionDate = parseDateLikeToIso(row[method.conclusionDateKey])
    const hasConclusion = hasFinalLnkResult(row, method)
    const hasRequestTrace = Boolean(requestName || requestDate || hasConclusion)
    if (!hasRequestTrace) continue

    const joint = formatJoint(row)
    if (options.includeMissingRequestDateIssue && hasConclusion && !requestDate) {
      issues.push({
        kind: 'request-date-missing',
        methodCode: method.code,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: у ${method.code} есть заключение, но нет даты заявки ЛНК.`,
      })
      continue
    }

    if (requestDate && weldDate && requestDate < weldDate) {
      issues.push({
        kind: 'weld-after-request',
        methodCode: method.code,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата заявки ${method.code} ${formatDisplayDate(requestDate)} раньше даты сварки ${formatDisplayDate(weldDate)}.`,
      })
    }

    if (requestDate && conclusionDate && conclusionDate < requestDate) {
      issues.push({
        kind: 'request-after-conclusion',
        methodCode: method.code,
        reason: LNK_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата заключения ${method.code} ${formatDisplayDate(conclusionDate)} раньше даты заявки ${formatDisplayDate(requestDate)}.`,
      })
    }
  }
  return issues
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

function formatJoint(row: LnkChronologyRow) {
  return String(row.joint ?? '').trim() || `ID ${String(row.id ?? '-')}`
}
