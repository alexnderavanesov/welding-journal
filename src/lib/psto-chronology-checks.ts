import { formatDisplayDate, parseDateLikeToIso } from '@/lib/date-format'
import {
  DEFAULT_SAVE_CHECK_SETTINGS,
  formatSaveCheckBlockReason,
  type SaveCheckSettings,
} from '@/lib/save-check-settings'
import type { WeldInput } from '@/lib/weld-fields'
import { buildPstoCycleTimeline, type PstoCycleSnapshot, type PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import { normalizeTvmtResult } from '@/lib/tvmt-cycle'

type PstoChronologyRow = WeldInput & { id?: number }

export const PSTO_REQUEST_DATE_ORDER_REASON = 'проверить даты ПСТО'

export type PstoChronologyIssueKind =
  | 'request-date-missing'
  | 'weld-after-request'
  | 'weld-after-result'
  | 'request-after-result'
  | 'psto-after-tvmt-request'
  | 'psto-after-tvmt-result'
  | 'tvmt-request-after-result'
  | 'previous-tvmt-after-repeat-request'
  | 'repeat-without-failed-tvmt'
  | 'tvmt-request-date-missing'

export type PstoChronologyIssue = {
  kind: PstoChronologyIssueKind
  reason: string
  message: string
  row: PstoChronologyRow
}

type PstoChronologyOptions = {
  includeResultBeforeWeldIssue?: boolean
  includeMissingRequestDateIssue?: boolean
  includeInvalidRepeatTriggerIssue?: boolean
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
    const weldDate = parseDateLikeToIso(row.weldDate)
    const joint = formatJoint(row)
    const cycles = buildPstoCycleTimeline(row, getRepeatCycles(row))
    for (const [cycleIndex, cycle] of cycles.entries()) {
      const previousCycle = cycles[cycleIndex - 1]
      issues.push(...getCycleIssues({
        row,
        joint,
        cycle,
        previousCycle,
        weldDate,
        options,
      }))
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

export function findFirstPstoChronologySaveBlockReason(
  rows: WeldInput[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const issue = getPstoChronologyIssues(rows, settings)[0]
  return issue ? formatSaveCheckBlockReason('pstoResultRequestDateOrder', issue.message) : ''
}

export function findFirstNewPstoChronologySaveBlockReason(
  rows: WeldInput[],
  previousRows: WeldInput[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const previousIssueKeys = new Set(
    getPstoChronologyIssues(previousRows, settings).map(getPstoChronologyIssueIdentity),
  )
  const issue = getPstoChronologyIssues(rows, settings)
    .find((candidate) => !previousIssueKeys.has(getPstoChronologyIssueIdentity(candidate)))
  return issue ? formatSaveCheckBlockReason('pstoResultRequestDateOrder', issue.message) : ''
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
      includeResultBeforeWeldIssue: true,
      includeMissingRequestDateIssue: true,
      includeInvalidRepeatTriggerIssue: true,
    },
  )
}

function getCycleIssues({
  row,
  joint,
  cycle,
  previousCycle,
  weldDate,
  options,
}: {
  row: PstoChronologyRow
  joint: string
  cycle: PstoCycleSnapshot
  previousCycle?: PstoCycleSnapshot
  weldDate: string | null
  options: PstoChronologyOptions
}) {
  const issues: PstoChronologyIssue[] = []
  const requestDate = parseDateLikeToIso(cycle.pstoRequestDate)
  const resultDate = parseDateLikeToIso(cycle.pstoDate)
  const tvmtRequestDate = parseDateLikeToIso(cycle.tvmtRequestDate)
  const tvmtResultDate = parseDateLikeToIso(cycle.tvmtConclusionDate)
  const previousTvmtDate = parseDateLikeToIso(previousCycle?.tvmtConclusionDate)
  const hasResult = hasFinalPstoResult(cycle.pstoResult)
  const hasTvmtResult = normalizeTvmtResult(cycle.tvmtResult) !== null
  const pstoLabel = cycle.sequence === 1 ? 'ПСТО' : `повторной ПСТО #${cycle.sequence}`
  const tvmtLabel = cycle.sequence === 1 ? 'ТВМТ' : `ТВМТ цикла #${cycle.sequence}`
  const hasTrace = Boolean(
    cycle.pstoRequest || requestDate || hasResult || resultDate ||
    cycle.tvmtRequest || tvmtRequestDate || hasTvmtResult || tvmtResultDate,
  )
  if (!hasTrace) return issues

  if (
    options.includeInvalidRepeatTriggerIssue &&
    previousCycle &&
    normalizeTvmtResult(previousCycle.tvmtResult) !== 'failed'
  ) {
    issues.push(createIssue(
      row,
      'repeat-without-failed-tvmt',
      `Стык ${joint}: цикл #${cycle.sequence} создан без негодной ТВМТ предыдущего цикла.`,
    ))
  }

  if (options.includeMissingRequestDateIssue && hasResult && !requestDate) {
    issues.push(createIssue(
      row,
      'request-date-missing',
      `Стык ${joint}: у ${pstoLabel} есть результат, но нет даты заявки ПСТО.`,
    ))
  }
  if (options.includeMissingRequestDateIssue && hasTvmtResult && !tvmtRequestDate) {
    issues.push(createIssue(
      row,
      'tvmt-request-date-missing',
      `Стык ${joint}: у ${tvmtLabel} есть результат, но нет даты заявки ТВМТ.`,
    ))
  }
  if (requestDate && weldDate && requestDate < weldDate) {
    issues.push(createIssue(
      row,
      'weld-after-request',
      `Стык ${joint}: дата заявки ${pstoLabel} ${formatDisplayDate(requestDate)} раньше даты сварки ${formatDisplayDate(weldDate)}.`,
    ))
  }
  if (options.includeResultBeforeWeldIssue && hasResult && resultDate && weldDate && resultDate < weldDate) {
    issues.push(createIssue(
      row,
      'weld-after-result',
      `Стык ${joint}: дата результата ${pstoLabel} ${formatDisplayDate(resultDate)} раньше даты сварки ${formatDisplayDate(weldDate)}.`,
    ))
  }
  if (requestDate && resultDate && resultDate < requestDate) {
    issues.push(createIssue(
      row,
      'request-after-result',
      `Стык ${joint}: дата результата ${pstoLabel} ${formatDisplayDate(resultDate)} раньше даты заявки ПСТО ${formatDisplayDate(requestDate)}.`,
    ))
  }
  if (requestDate && previousTvmtDate && requestDate < previousTvmtDate) {
    issues.push(createIssue(
      row,
      'previous-tvmt-after-repeat-request',
      `Стык ${joint}: дата заявки ${pstoLabel} ${formatDisplayDate(requestDate)} раньше результата предыдущей ТВМТ ${formatDisplayDate(previousTvmtDate)}.`,
    ))
  }
  if (tvmtRequestDate && resultDate && tvmtRequestDate < resultDate) {
    issues.push(createIssue(
      row,
      'psto-after-tvmt-request',
      `Стык ${joint}: дата заявки ${tvmtLabel} ${formatDisplayDate(tvmtRequestDate)} раньше даты ${pstoLabel} ${formatDisplayDate(resultDate)}.`,
    ))
  }
  if (tvmtResultDate && resultDate && tvmtResultDate < resultDate) {
    issues.push(createIssue(
      row,
      'psto-after-tvmt-result',
      `Стык ${joint}: дата результата ${tvmtLabel} ${formatDisplayDate(tvmtResultDate)} раньше даты ${pstoLabel} ${formatDisplayDate(resultDate)}.`,
    ))
  }
  if (tvmtRequestDate && tvmtResultDate && tvmtResultDate < tvmtRequestDate) {
    issues.push(createIssue(
      row,
      'tvmt-request-after-result',
      `Стык ${joint}: дата результата ${tvmtLabel} ${formatDisplayDate(tvmtResultDate)} раньше даты заявки ТВМТ ${formatDisplayDate(tvmtRequestDate)}.`,
    ))
  }
  return issues
}

function createIssue(
  row: PstoChronologyRow,
  kind: PstoChronologyIssueKind,
  message: string,
): PstoChronologyIssue {
  return { kind, reason: PSTO_REQUEST_DATE_ORDER_REASON, row, message }
}

function getPstoChronologyIssueIdentity(issue: PstoChronologyIssue) {
  return `${issue.kind}\u0000${issue.message}`
}

function hasFinalPstoResult(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return result === 'проведено' || result === 'проведено (отменен)' || result === 'да'
}

function getRepeatCycles(row: PstoChronologyRow) {
  return ((row as PstoChronologyRow & { pstoRepeatCycles?: PstoRepeatCycleRecord[] }).pstoRepeatCycles ?? [])
}

function formatJoint(row: PstoChronologyRow) {
  return String(row.joint ?? '').trim() || `ID ${String(row.id ?? '-')}`
}
