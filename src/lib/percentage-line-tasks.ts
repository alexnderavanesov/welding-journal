import { buildPercentageLineSummaries, type PercentageLineStampSummary } from '@/lib/percentage-line-summary'
import { getRejectedDuplicateControls } from '@/lib/duplicate-control-utils'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import { normalizeResultStatus } from '@/lib/weld-status'
import { getSuspensionOverlapForStamp } from '@/lib/welder-stamp-suspensions'
import type { PercentageLineControlTask, WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export function buildPercentageLineControlTasks(
  rows: WeldRow[],
  welderStampSuspensions: WelderStampSuspensionRecord[] = [],
): PercentageLineControlTask[] {
  const tasks: PercentageLineControlTask[] = []

  for (const lineSummary of buildPercentageLineSummaries(rows)) {
    const firstStampSummaryKey = getFirstStampSummaryKey(lineSummary.rows, lineSummary.stamps)
    for (const stampSummary of lineSummary.stamps) {
      const sampleRow = findStampRow(lineSummary.rows, stampSummary.stamp) ?? lineSummary.rows[0]
      const rejectedRows = findRowsByIds(lineSummary.rows, stampSummary.rejectedPrimaryRowIds)
      if (!sampleRow) continue

      if (lineSummary.stamps.length > 1 && stampSummary.key !== firstStampSummaryKey) {
        tasks.push(buildNewWelderTask(sampleRow, stampSummary, lineSummary.stamps.length))
      }

      if (stampSummary.missingControls > 0) {
        tasks.push(buildMissingControlTask(sampleRow, stampSummary))
      }

      if (stampSummary.excessControls > 0) {
        tasks.push(buildExcessControlTask(sampleRow, stampSummary))
      }

      if (stampSummary.rejectedPrimaryControls > 0) {
        tasks.push(buildRejectedPrimaryControlTask(rejectedRows[0] ?? sampleRow, stampSummary))
      }

      if (stampSummary.fullControlRequired) {
        const suspensionRow = rejectedRows[3] ?? rejectedRows.at(-1) ?? sampleRow
        const suspensionFrom = getRejectedControlEventDate(suspensionRow)
        if (!isWelderAlreadySuspended(stampSummary.stamp, suspensionFrom, welderStampSuspensions)) {
          tasks.push(buildSuspendWelderTask(suspensionRow, stampSummary, suspensionFrom))
        }
      }
    }
  }

  return tasks
}

function buildNewWelderTask(
  row: WeldRow,
  summary: PercentageLineStampSummary,
  lineStampCount: number,
): PercentageLineControlTask {
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%, новое клеймо ${summary.stamp}.`,
    `На процентной линии уже участвует ${lineStampCount} официальных клейм. Каждый новый сварщик увеличивает минимальный объем РК/УЗК по этой линии.`,
    `По клейму ${summary.stamp} сейчас сварено ${summary.officialJointCount} стык(ов), базово требуется ${summary.baseRequiredControls} стык(ов) РК/УЗК.`,
    'Проверь, не ошибочно ли указано официальное клеймо. Если клеймо верное, можно принять это предупреждение.',
  ]

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:new-welder:${summary.key}`,
    row,
    issue: 'new-welder',
    projectTitle: summary.projectTitle,
    subtitleCode: summary.subtitleCode,
    line: summary.line,
    stamp: summary.stamp,
    title: 'Новый сварщик на процентной линии',
    details: detailParts.join(' '),
    requiredControls: summary.requiredControls,
    coveredControls: summary.coveredControls,
    assignedControls: summary.assignedControls,
    count: summary.officialJointCount,
  }
}

function buildMissingControlTask(row: WeldRow, summary: PercentageLineStampSummary): PercentageLineControlTask {
  const title = summary.fullControlRequired
    ? 'Назначить 100% РК/УЗК по клейму'
    : 'Назначить РК/УЗК по процентной линии'
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%, клеймо ${summary.stamp}.`,
    summary.fullControlRequired
      ? `По клейму уже ${summary.rejectedPrimaryControls} первичных негодных стыков по РК/УЗК, включая дубль РК/УЗК, поэтому требуется РК/УЗК для всех ${summary.officialJointCount} стыков этого клейма.`
      : `По расчету требуется ${summary.calculatedRequiredControls} стык(ов) РК/УЗК: базово ${summary.baseRequiredControls}, дополнительно ${summary.additionalRequiredControls}.`,
    summary.availableRequiredControls < summary.calculatedRequiredControls
      ? `Доступно для закрытия ${summary.availableRequiredControls} стык(ов), поэтому к закрытию берется ${summary.requiredControls}.`
      : `К закрытию берется ${summary.requiredControls} стык(ов).`,
    `Закрыто расчетом ${summary.coveredControls}, осталось закрыть ${summary.missingControls}.`,
  ]
  if (summary.missingCandidateJointNames.length > 0) {
    detailParts.push(`Кандидаты без закрытия расчета: ${formatJointList(summary.missingCandidateJointNames)}.`)
  }
  detailParts.push(
    'Закрытием расчета считается назначенный РК или УЗК, выполненный результат РК/УЗК, осознанный пропуск "отменен" одновременно в РК и УЗК либо статус "замена РК/УЗК" на другом виде НК.',
    'Если стык уже имеет негодный результат по любому контролю, он не попадает в кандидаты на назначение РК/УЗК.',
  )

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:missing:${summary.key}:${summary.requiredControls}:${summary.coveredControls}`,
    row,
    issue: 'missing',
    projectTitle: summary.projectTitle,
    subtitleCode: summary.subtitleCode,
    line: summary.line,
    stamp: summary.stamp,
    title,
    details: detailParts.join(' '),
    targetRowIds: summary.missingCandidateRowIds,
    requiredControls: summary.requiredControls,
    coveredControls: summary.coveredControls,
    assignedControls: summary.assignedControls,
    count: summary.missingControls,
  }
}

function buildExcessControlTask(row: WeldRow, summary: PercentageLineStampSummary): PercentageLineControlTask {
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%, клеймо ${summary.stamp}.`,
    `По расчету требуется ${summary.requiredControls} стык(ов) РК/УЗК, а обычным статусом "да" назначено ${summary.normalAssignedControls}.`,
    `Лишних обычных "да": ${summary.excessControls}.`,
  ]
  if (summary.excessCandidateJointNames.length > 0) {
    detailParts.push(`Проверь назначенные стыки: ${formatJointList(summary.excessCandidateJointNames)}.`)
  }
  detailParts.push('Если контроль назначен осознанно сверх процента, используй статус "дополнительный", тогда диспетчер не будет считать его лишним обычным "да".')

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:excess:${summary.key}:${summary.requiredControls}:${summary.assignedControls}:${toTaskKeyPart(summary.excessCandidateJointNames)}`,
    row,
    issue: 'excess',
    projectTitle: summary.projectTitle,
    subtitleCode: summary.subtitleCode,
    line: summary.line,
    stamp: summary.stamp,
    title: 'Проверить лишний контроль процентной линии',
    details: detailParts.join(' '),
    targetRowIds: summary.excessCandidateRowIds,
    requiredControls: summary.requiredControls,
    coveredControls: summary.coveredControls,
    assignedControls: summary.assignedControls,
    count: summary.excessControls,
  }
}

function buildRejectedPrimaryControlTask(row: WeldRow, summary: PercentageLineStampSummary): PercentageLineControlTask {
  const rejectedNames = summary.rejectedPrimaryJointNames
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%, клеймо ${summary.stamp}.`,
    `Найдено ${summary.rejectedPrimaryControls} первичных официальных стык(ов) с негодным результатом по РК/УЗК, включая дубль РК/УЗК.`,
  ]
  if (rejectedNames.length > 0) {
    detailParts.push(`Проверь официальность стыков: ${formatJointList(rejectedNames)}.`)
  }
  detailParts.push('Если стык должен быть неофициальным, измени официальность через меню ЛНК. Это влияет на расчет процентной линии и дальнейший объем контроля.')

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:rejected-primary:${summary.key}:${summary.rejectedPrimaryControls}:${toTaskKeyPart(summary.rejectedPrimaryRowIds)}`,
    row,
    issue: 'rejected-primary',
    projectTitle: summary.projectTitle,
    subtitleCode: summary.subtitleCode,
    line: summary.line,
    stamp: summary.stamp,
    title: 'Проверить официальность на процентной линии',
    details: detailParts.join(' '),
    targetRowIds: summary.rejectedPrimaryRowIds,
    requiredControls: summary.requiredControls,
    coveredControls: summary.coveredControls,
    assignedControls: summary.assignedControls,
    count: summary.rejectedPrimaryControls,
  }
}

function buildSuspendWelderTask(
  row: WeldRow,
  summary: PercentageLineStampSummary,
  suspensionFrom: string,
): PercentageLineControlTask {
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%, клеймо ${summary.stamp}.`,
    `По клейму найдено ${summary.rejectedPrimaryControls} первичных негодных стыков по РК/УЗК, включая дубль РК/УЗК: ${formatJointList(summary.rejectedPrimaryJointNames)}.`,
    'По правилу процентной линии после четвертого первичного негодного результата сварщика нужно отстранить от официальной сварки до отдельного решения.',
    suspensionFrom
      ? `Дату начала отстранения диспетчер предлагает взять по дате контроля четвертого негодного стыка: ${suspensionFrom}.`
      : 'Дату начала отстранения нужно определить по дате контроля четвертого негодного стыка.',
  ]

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:suspend-welder:${summary.key}:${summary.rejectedPrimaryControls}:${toTaskKeyPart(summary.rejectedPrimaryRowIds)}`,
    row,
    issue: 'suspend-welder',
    projectTitle: summary.projectTitle,
    subtitleCode: summary.subtitleCode,
    line: summary.line,
    stamp: summary.stamp,
    title: 'Отстранить сварщика от работы',
    details: detailParts.join(' '),
    targetRowIds: summary.rejectedPrimaryRowIds,
    suspensionFrom,
    requiredControls: summary.requiredControls,
    coveredControls: summary.coveredControls,
    assignedControls: summary.assignedControls,
    count: summary.rejectedPrimaryControls,
  }
}

function isWelderAlreadySuspended(
  stamp: string,
  suspensionFrom: string,
  welderStampSuspensions: WelderStampSuspensionRecord[],
) {
  if (!suspensionFrom) return false
  return Boolean(getSuspensionOverlapForStamp(welderStampSuspensions, stamp, suspensionFrom))
}

function findStampRow(rows: WeldRow[], stamp: string) {
  const normalizedStamp = normalizeValue(stamp)
  return rows
    .filter((row) => OFFICIAL_WELDER_STAMP_FIELD_KEYS.some((key) => normalizeValue(row[key]) === normalizedStamp))
    .sort((left, right) => compareDateLike(left.weldDate, right.weldDate) || Number(left.id ?? 0) - Number(right.id ?? 0))[0]
}

function getFirstStampSummaryKey(rows: WeldRow[], summaries: PercentageLineStampSummary[]) {
  const ordered = summaries
    .map((summary) => ({ summary, row: findStampRow(rows, summary.stamp) }))
    .filter((entry): entry is { summary: PercentageLineStampSummary; row: WeldRow } => Boolean(entry.row))
    .sort(
      (left, right) =>
        compareDateLike(left.row.weldDate, right.row.weldDate) ||
        Number(left.row.id ?? 0) - Number(right.row.id ?? 0) ||
        left.summary.stamp.localeCompare(right.summary.stamp, 'ru', { numeric: true }),
    )
  return ordered[0]?.summary.key ?? ''
}

function findRowsByIds(rows: WeldRow[], rowIds: number[]) {
  const ids = new Set(rowIds)
  return rows
    .filter((row) => ids.has(row.id))
    .sort(compareRejectedPrimaryRows)
}

function compareRejectedPrimaryRows(left: WeldRow, right: WeldRow) {
  return (
    compareDateLike(getRejectedControlEventDate(left), getRejectedControlEventDate(right)) ||
    compareDateLike(left.weldDate, right.weldDate) ||
    Number(left.id ?? 0) - Number(right.id ?? 0)
  )
}

function getRejectedControlEventDate(row: WeldRow) {
  const rejectedDates = LNK_METHODS.filter((method) => method.code === 'РК' || method.code === 'УЗК').flatMap((method) => {
    const result = normalizeResultStatus(row[method.resultKey])
    if (result !== 'ремонт' && result !== 'вырез') return []
    const date = String(row[method.conclusionDateKey] ?? '').trim()
    return date ? [date] : []
  })
  const rejectedDuplicateDates = getRejectedDuplicateControls(row).flatMap((control) => {
    if (control.method !== 'РК' && control.method !== 'УЗК') return []
    return control.conclusionDate || control.controlDate ? [control.conclusionDate || control.controlDate] : []
  })

  return [...rejectedDates, ...rejectedDuplicateDates].sort(compareDateLike)[0] ?? String(row.weldDate ?? '').trim()
}

function compareDateLike(left: unknown, right: unknown) {
  const leftTime = parseDateLikeTime(left)
  const rightTime = parseDateLikeTime(right)
  return leftTime - rightTime
}

function parseDateLikeTime(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return Number.MAX_SAFE_INTEGER
  const parts = text.split('.')
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number)
    const time = new Date(year, month - 1, day).getTime()
    return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER
  }
  const time = new Date(text).getTime()
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER
}

function formatJointList(values: string[]) {
  return values.slice(0, 8).join(', ') + (values.length > 8 ? ` и еще ${values.length - 8}` : '')
}

function toTaskKeyPart(values: Array<string | number>) {
  return values.map((value) => String(value).trim().toLowerCase()).sort().join(',')
}

function normalizeValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}
