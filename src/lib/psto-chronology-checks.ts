import { formatDisplayDate, parseDateLikeToIso } from '@/lib/date-format'
import { DEFAULT_SAVE_CHECK_SETTINGS, type SaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldInput } from '@/lib/weld-fields'

type PstoChronologyRow = WeldInput & { id?: number }

export const PSTO_REQUEST_DATE_ORDER_REASON = 'проверить даты заявки ПСТО'

export type PstoChronologyIssueKind =
  | 'request-date-missing'
  | 'weld-after-request'
  | 'request-after-result'

export type PstoChronologyIssue = {
  kind: PstoChronologyIssueKind
  reason: string
  message: string
  row: PstoChronologyRow
}

type PstoChronologyOptions = {
  includeMissingRequestDateIssue?: boolean
}

export function isPstoChronologyCheckReason(reason?: string) {
  return reason === PSTO_REQUEST_DATE_ORDER_REASON
}

export function getPstoChronologyIssues(
  rows: PstoChronologyRow[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  options: PstoChronologyOptions = {},
): PstoChronologyIssue[] {
  if (!settings.pstoResultRequestDateOrder) return []

  const issues: PstoChronologyIssue[] = []
  for (const row of rows) {
    const requestName = String(row.pstoRequest ?? '').trim()
    const requestDate = parseDateLikeToIso(row.pstoRequestDate)
    const weldDate = parseDateLikeToIso(row.weldDate)
    const resultDate = parseDateLikeToIso(row.pstoDate)
    const hasResult = hasFinalPstoResult(row)
    const hasRequestTrace = Boolean(requestName || requestDate || hasResult || resultDate)
    if (!hasRequestTrace) continue

    const joint = formatJoint(row)
    if (options.includeMissingRequestDateIssue && hasResult && !requestDate) {
      issues.push({
        kind: 'request-date-missing',
        reason: PSTO_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: у ПСТО есть результат, но нет даты заявки ПСТО.`,
      })
      continue
    }

    if (requestDate && weldDate && requestDate < weldDate) {
      issues.push({
        kind: 'weld-after-request',
        reason: PSTO_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата заявки ПСТО ${formatDisplayDate(requestDate)} раньше даты сварки ${formatDisplayDate(weldDate)}.`,
      })
    }

    if (requestDate && resultDate && resultDate < requestDate) {
      issues.push({
        kind: 'request-after-result',
        reason: PSTO_REQUEST_DATE_ORDER_REASON,
        row,
        message: `Стык ${joint}: дата результата ПСТО ${formatDisplayDate(resultDate)} раньше даты заявки ПСТО ${formatDisplayDate(requestDate)}.`,
      })
    }
  }
  return issues
}

export function findFirstPstoChronologyIssue(
  rows: WeldInput[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  return getPstoChronologyIssues(rows, settings)[0]?.message ?? ''
}

export function assertNoPstoChronologyIssues(
  rows: WeldInput[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const issue = findFirstPstoChronologyIssue(rows, settings)
  if (issue) throw new Error(issue)
}

export function getDispatcherPstoChronologyIssues(rows: PstoChronologyRow[]) {
  return getPstoChronologyIssues(
    rows,
    {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      pstoResultRequestDateOrder: true,
    },
    {
      includeMissingRequestDateIssue: true,
    },
  )
}

function hasFinalPstoResult(row: WeldInput) {
  const result = String(row.pstoResult ?? '').trim().toLowerCase()
  return result === 'проведено' || result === 'проведено (отменен)' || result === 'да'
}

function formatJoint(row: PstoChronologyRow) {
  return String(row.joint ?? '').trim() || `ID ${String(row.id ?? '-')}`
}
