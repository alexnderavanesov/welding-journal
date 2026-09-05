import { formatDisplayDate, getDateInputValidationReason, parseDateLikeToIso } from '@/lib/date-format'
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
  | 'request-date-invalid'
  | 'request-name-missing'
  | 'weld-after-request'
  | 'weld-after-result'
  | 'result-date-invalid'
  | 'request-after-result'
  | 'psto-after-tvmt-request'
  | 'psto-after-tvmt-result'
  | 'tvmt-request-after-result'
  | 'previous-tvmt-after-repeat-request'
  | 'repeat-without-failed-tvmt'
  | 'tvmt-request-date-missing'
  | 'tvmt-request-date-invalid'
  | 'tvmt-request-name-missing'
  | 'tvmt-result-date-invalid'

export type PstoChronologyIssue = {
  kind: PstoChronologyIssueKind
  sequence: number
  cycleId?: number
  cycleSource: 'primary' | 'repeat'
  documentStage: 'pstoRequest' | 'pstoResult' | 'tvmtRequest' | 'tvmtResult'
  reason: string
  message: string
  row: PstoChronologyRow
}

type PstoChronologyOptions = {
  includeInvalidDateIssues?: boolean
  includeResultBeforeWeldIssue?: boolean
  includeRequestIntegrityIssues?: boolean
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
  if (
    !settings.pstoResultRequestDateOrder &&
    !settings.pstoResultDateAfterWeldDate &&
    !options.includeInvalidDateIssues &&
    !options.includeResultBeforeWeldIssue &&
    !options.includeRequestIntegrityIssues &&
    !options.includeInvalidRepeatTriggerIssue
  ) return []

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
        settings,
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
  return issue ? formatPstoChronologyIssueSaveBlockReason(issue) : ''
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
  return issue ? formatPstoChronologyIssueSaveBlockReason(issue) : ''
}

export function assertNoNewPstoChronologyIssues(
  rows: WeldInput[],
  previousRows: WeldInput[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const issue = findFirstNewPstoChronologySaveBlockReason(rows, previousRows, settings)
  if (issue) throw new Error(issue)
}

export function assertNoPstoChronologyIssues(
  rows: WeldInput[],
  settings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const issue = findFirstPstoChronologySaveBlockReason(rows, settings)
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
      includeInvalidDateIssues: true,
      includeRequestIntegrityIssues: true,
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
  settings,
  options,
}: {
  row: PstoChronologyRow
  joint: string
  cycle: PstoCycleSnapshot
  previousCycle?: PstoCycleSnapshot
  weldDate: string | null
  settings: SaveCheckSettings
  options: PstoChronologyOptions
}) {
  const issues: PstoChronologyIssue[] = []
  const pstoRequestName = String(cycle.pstoRequest ?? '').trim()
  const hasPstoRequestDate = hasDateInputValue(cycle.pstoRequestDate)
  const requestDate = parseDateLikeToIso(cycle.pstoRequestDate)
  const hasPstoResultDate = hasDateInputValue(cycle.pstoDate)
  const resultDate = parseDateLikeToIso(cycle.pstoDate)
  const tvmtRequestName = String(cycle.tvmtRequest ?? '').trim()
  const hasTvmtRequestDate = hasDateInputValue(cycle.tvmtRequestDate)
  const tvmtRequestDate = parseDateLikeToIso(cycle.tvmtRequestDate)
  const hasTvmtResultDate = hasDateInputValue(cycle.tvmtConclusionDate)
  const tvmtResultDate = parseDateLikeToIso(cycle.tvmtConclusionDate)
  const previousTvmtDate = parseDateLikeToIso(previousCycle?.tvmtConclusionDate)
  const hasResult = hasFinalPstoResult(cycle.pstoResult)
  const hasTvmtResult = normalizeTvmtResult(cycle.tvmtResult) !== null
  const pstoLabel = cycle.sequence === 1 ? 'ПСТО' : `повторной ПСТО #${cycle.sequence}`
  const tvmtLabel = cycle.sequence === 1 ? 'ТВМТ' : `ТВМТ цикла #${cycle.sequence}`
  const hasTrace = Boolean(
    cycle.pstoRequest || hasPstoRequestDate || hasResult || hasPstoResultDate ||
    cycle.tvmtRequest || hasTvmtRequestDate || hasTvmtResult || hasTvmtResultDate,
  )
  if (!hasTrace) return issues

  const hasTvmtTrace = Boolean(
    tvmtRequestName || hasTvmtRequestDate || hasTvmtResult ||
    hasTvmtResultDate || String(cycle.tvmtConclusion ?? '').trim(),
  )
  const hasPstoTrace = Boolean(
    pstoRequestName || hasPstoRequestDate || hasResult || hasPstoResultDate || hasTvmtTrace,
  )

  if (
    options.includeInvalidRepeatTriggerIssue &&
    previousCycle &&
    normalizeTvmtResult(previousCycle.tvmtResult) !== 'failed'
  ) {
    issues.push(createIssue(
      row,
      cycle,
      'repeat-without-failed-tvmt',
      `Стык ${joint}: цикл #${cycle.sequence} создан без негодной ТВМТ предыдущего цикла.`,
    ))
  }

  const requestDateReason = getDateInputValidationReason(cycle.pstoRequestDate, `Дата заявки ${pstoLabel}`)
  const resultDateReason = getDateInputValidationReason(cycle.pstoDate, `Дата результата ${pstoLabel}`)
  const tvmtRequestDateReason = getDateInputValidationReason(cycle.tvmtRequestDate, `Дата заявки ${tvmtLabel}`)
  const tvmtResultDateReason = getDateInputValidationReason(cycle.tvmtConclusionDate, `Дата результата ${tvmtLabel}`)
  if (options.includeInvalidDateIssues && requestDateReason) {
    issues.push(createIssue(
      row,
      cycle,
      'request-date-invalid',
      `Стык ${joint}: ${requestDateReason}`,
    ))
  } else if (options.includeRequestIntegrityIssues && hasPstoTrace && !hasPstoRequestDate) {
    issues.push(createIssue(
      row,
      cycle,
      'request-date-missing',
      `Стык ${joint}: у ${pstoLabel} есть данные цикла, но нет даты заявки ПСТО.`,
    ))
  }
  if (options.includeInvalidDateIssues && resultDateReason) {
    issues.push(createIssue(
      row,
      cycle,
      'result-date-invalid',
      `Стык ${joint}: ${resultDateReason}`,
    ))
  }
  if (options.includeRequestIntegrityIssues && hasPstoTrace && !pstoRequestName) {
    issues.push(createIssue(
      row,
      cycle,
      'request-name-missing',
      `Стык ${joint}: у ${pstoLabel} есть данные цикла, но нет наименования заявки ПСТО.`,
    ))
  }
  if (options.includeInvalidDateIssues && tvmtRequestDateReason) {
    issues.push(createIssue(
      row,
      cycle,
      'tvmt-request-date-invalid',
      `Стык ${joint}: ${tvmtRequestDateReason}`,
    ))
  } else if (options.includeRequestIntegrityIssues && hasTvmtTrace && !hasTvmtRequestDate) {
    issues.push(createIssue(
      row,
      cycle,
      'tvmt-request-date-missing',
      `Стык ${joint}: у ${tvmtLabel} есть данные контроля, но нет даты заявки ТВМТ.`,
    ))
  }
  if (options.includeInvalidDateIssues && tvmtResultDateReason) {
    issues.push(createIssue(
      row,
      cycle,
      'tvmt-result-date-invalid',
      `Стык ${joint}: ${tvmtResultDateReason}`,
    ))
  }
  if (options.includeRequestIntegrityIssues && hasTvmtTrace && !tvmtRequestName) {
    issues.push(createIssue(
      row,
      cycle,
      'tvmt-request-name-missing',
      `Стык ${joint}: у ${tvmtLabel} есть данные контроля, но нет наименования заявки ТВМТ.`,
    ))
  }
  if (settings.pstoResultRequestDateOrder && requestDate && weldDate && requestDate < weldDate) {
    issues.push(createIssue(
      row,
      cycle,
      'weld-after-request',
      `Стык ${joint}: дата заявки ${pstoLabel} ${formatDisplayDate(requestDate)} раньше даты сварки ${formatDisplayDate(weldDate)}.`,
    ))
  }
  if (
    (settings.pstoResultDateAfterWeldDate || options.includeResultBeforeWeldIssue) &&
    hasResult &&
    resultDate &&
    weldDate &&
    resultDate < weldDate
  ) {
    issues.push(createIssue(
      row,
      cycle,
      'weld-after-result',
      `Стык ${joint}: дата результата ${pstoLabel} ${formatDisplayDate(resultDate)} раньше даты сварки ${formatDisplayDate(weldDate)}.`,
    ))
  }
  if (settings.pstoResultRequestDateOrder && requestDate && resultDate && resultDate < requestDate) {
    issues.push(createIssue(
      row,
      cycle,
      'request-after-result',
      `Стык ${joint}: дата результата ${pstoLabel} ${formatDisplayDate(resultDate)} раньше даты заявки ПСТО ${formatDisplayDate(requestDate)}.`,
    ))
  }
  if (settings.pstoResultRequestDateOrder && requestDate && previousTvmtDate && requestDate < previousTvmtDate) {
    issues.push(createIssue(
      row,
      cycle,
      'previous-tvmt-after-repeat-request',
      `Стык ${joint}: дата заявки ${pstoLabel} ${formatDisplayDate(requestDate)} раньше результата предыдущей ТВМТ ${formatDisplayDate(previousTvmtDate)}.`,
    ))
  }
  if (settings.pstoResultRequestDateOrder && tvmtRequestDate && resultDate && tvmtRequestDate < resultDate) {
    issues.push(createIssue(
      row,
      cycle,
      'psto-after-tvmt-request',
      `Стык ${joint}: дата заявки ${tvmtLabel} ${formatDisplayDate(tvmtRequestDate)} раньше даты ${pstoLabel} ${formatDisplayDate(resultDate)}.`,
    ))
  }
  if (settings.pstoResultRequestDateOrder && tvmtResultDate && resultDate && tvmtResultDate < resultDate) {
    issues.push(createIssue(
      row,
      cycle,
      'psto-after-tvmt-result',
      `Стык ${joint}: дата результата ${tvmtLabel} ${formatDisplayDate(tvmtResultDate)} раньше даты ${pstoLabel} ${formatDisplayDate(resultDate)}.`,
    ))
  }
  if (settings.pstoResultRequestDateOrder && tvmtRequestDate && tvmtResultDate && tvmtResultDate < tvmtRequestDate) {
    issues.push(createIssue(
      row,
      cycle,
      'tvmt-request-after-result',
      `Стык ${joint}: дата результата ${tvmtLabel} ${formatDisplayDate(tvmtResultDate)} раньше даты заявки ТВМТ ${formatDisplayDate(tvmtRequestDate)}.`,
    ))
  }
  return issues
}

function createIssue(
  row: PstoChronologyRow,
  cycle: PstoCycleSnapshot,
  kind: PstoChronologyIssueKind,
  message: string,
): PstoChronologyIssue {
  return {
    kind,
    sequence: cycle.sequence,
    ...(cycle.id ? { cycleId: cycle.id } : {}),
    cycleSource: cycle.source,
    documentStage: getIssueDocumentStage(kind),
    reason: PSTO_REQUEST_DATE_ORDER_REASON,
    row,
    message,
  }
}

function getIssueDocumentStage(kind: PstoChronologyIssueKind): PstoChronologyIssue['documentStage'] {
  if (
    kind === 'tvmt-request-date-missing' ||
    kind === 'tvmt-request-date-invalid' ||
    kind === 'tvmt-request-name-missing' ||
    kind === 'psto-after-tvmt-request'
  ) return 'tvmtRequest'
  if (
    kind === 'tvmt-result-date-invalid' ||
    kind === 'tvmt-request-after-result' ||
    kind === 'psto-after-tvmt-result' ||
    kind === 'repeat-without-failed-tvmt'
  ) return 'tvmtResult'
  if (
    kind === 'result-date-invalid' ||
    kind === 'weld-after-result' ||
    kind === 'request-after-result'
  ) return 'pstoResult'
  return 'pstoRequest'
}

function getPstoChronologyIssueIdentity(issue: PstoChronologyIssue) {
  return `${issue.kind}\u0000${issue.message}`
}

function formatPstoChronologyIssueSaveBlockReason(issue: PstoChronologyIssue) {
  const settingId = issue.kind === 'weld-after-result'
    ? 'pstoResultDateAfterWeldDate'
    : 'pstoResultRequestDateOrder'
  return formatSaveCheckBlockReason(settingId, issue.message)
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

function hasDateInputValue(value: unknown) {
  const text = String(value ?? '').trim()
  return Boolean(text && text !== '-')
}
