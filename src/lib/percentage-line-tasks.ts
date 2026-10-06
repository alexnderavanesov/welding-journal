import {
  buildPercentageLineSummaries,
  getPercentageLineNewWelderWarningKey,
  type PercentageLineStampSummary,
} from '@/lib/percentage-line-summary'
import { getRejectedDuplicateControls } from '@/lib/duplicate-control-utils'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { normalizeResultStatus } from '@/lib/weld-status'
import { getSuspensionOverlapForStamp } from '@/lib/welder-stamp-suspensions'
import { formatDisplayDate, parseDateLikeToIso } from '@/lib/date-format'
import type { PercentageLineControlTask, WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import { DEFAULT_SYSTEM_INDEX_SETTINGS, type SystemIndexSettings } from '@/lib/system-index-settings'
import { getLineProgramOfficialStamps } from '@/lib/line-program-calculation'
import { isPreHeatTreatmentStageEnabled } from '@/lib/pre-heat-treatment-policy'
import { formatProgramAssignmentAccounting, getProgramDemandAccounting } from './line-program-accounting'

export function buildPercentageLineControlTasks(
  rows: WeldRow[],
  welderStampSuspensions: WelderStampSuspensionRecord[] = [],
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
  approved: ReadonlySet<string> = new Set(),
): PercentageLineControlTask[] {
  const tasks: PercentageLineControlTask[] = []
  const rowsById = new Map(rows.map(row => [row.id, row]))

  for (const lineSummary of buildPercentageLineSummaries(rows, systemIndexSettings, approved)) {
    const firstRows = new Map<string, WeldRow>()
    for (const row of lineSummary.rows) {
      for (const stamp of getLineProgramOfficialStamps(row)) {
        const key = normalizeValue(stamp)
        const previous = firstRows.get(key)
        if (!previous || compareDateLike(row.weldDate, previous.weldDate) < 0 ||
          (compareDateLike(row.weldDate, previous.weldDate) === 0 && row.id < previous.id)) firstRows.set(key, row)
      }
    }
    const firstStampSummaryKey = [...lineSummary.stamps].sort((a, b) => {
      const left = firstRows.get(normalizeValue(a.stamp)) ?? lineSummary.rows[0]
      const right = firstRows.get(normalizeValue(b.stamp)) ?? lineSummary.rows[0]
      return compareDateLike(left.weldDate, right.weldDate) || left.id - right.id || a.stamp.localeCompare(b.stamp, 'ru')
    })[0]?.key
    const participatingStampCount = lineSummary.stamps.filter(stamp => stamp.officialJointCount > 0).length
    for (const stampSummary of lineSummary.stamps) {
      const sampleRow = firstRows.get(normalizeValue(stampSummary.stamp)) ?? lineSummary.rows[0]
      const rejectedRows = stampSummary.rejectedRowIds.map((id) => rowsById.get(id)).filter((row): row is WeldRow => !!row).sort(compareRejectedRows)
      if (!sampleRow) continue

      if (lineSummary.percent > 0 && lineSummary.percent < 100 && stampSummary.officialJointCount > 0 && participatingStampCount > 1 && stampSummary.key !== firstStampSummaryKey) {
        tasks.push(buildNewWelderTask(sampleRow, stampSummary, lineSummary.stamps.length))
      }

      if (stampSummary.missingControls > 0) {
        tasks.push(buildMissingControlTask(sampleRow, stampSummary))
      }

      if (stampSummary.common.excessRowIds.length > 0) {
        tasks.push(buildExcessControlTask(sampleRow, { ...stampSummary,
          excessControls: stampSummary.common.excessRowIds.length, excessCandidateRowIds: stampSummary.common.excessRowIds,
          excessCandidateJointNames: stampSummary.common.excessRowIds.map((id) => String(rowsById.get(id)?.joint ?? id)),
        }))
      }

      for (const issue of ['missing', 'excess'] as const) {
        const demand = stampSummary.pvk
        const count = issue === 'missing' ? demand.missing : demand.excessRowIds.length
        if (!count) continue
        tasks.push({
          kind: 'percentage-line-control', issue, demandKind: 'pvk',
          key: `percentage-line-control:pvk:${issue}:${stampSummary.key}:${demand.required}:${demand.coveredRowIds.length}`,
          row: sampleRow, projectTitle: stampSummary.projectTitle, subtitleCode: stampSummary.subtitleCode,
          line: stampSummary.line, stamp: stampSummary.stamp,
          title: issue === 'missing' ? 'Назначить ПВК по программе линии' : 'Проверить лишний ПВК',
          details: `Линия ${stampSummary.line}${stampSummary.stamp ? `, клеймо ${stampSummary.stamp}` : ', по всей линии'}. ПВК ${demand.percent}%: расчётная норма ${demand.required}, к закрытию с учётом доступных стыков ${demand.actionableRequired}, зачтено ${demand.coveredRowIds.length}, выполнено ${demand.completedRowIds.length}. ${issue === 'missing' ? 'Доступный недобор' : 'Лишние назначения'}: ${count}. Сопутствующий ПВК, необходимый для послойной замены, защищён.`,
          targetRowIds: issue === 'missing' ? demand.candidateRowIds : demand.excessRowIds,
          requiredControls: demand.actionableRequired, coveredControls: demand.coveredRowIds.length,
          assignedControls: new Set([...demand.assignedRowIds, ...demand.additionalRowIds]).size, count,
        })
      }

      if (lineSummary.percent > 0 && lineSummary.percent < 100 && stampSummary.rejectedControlRows > 0) {
        tasks.push(buildRejectedRowsControlTask(rejectedRows[0] ?? sampleRow, stampSummary))
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
    `На процентной линии уже участвует ${lineStampCount} официальных клейм. Каждый новый сварщик увеличивает минимальный объем контроля по этой линии.`,
    `По клейму ${summary.stamp} сейчас сварено ${summary.officialJointCount} стык(ов), базово требуется ${summary.baseRequiredControls} стык(ов) контроля.`,
    'Проверь, не ошибочно ли указано официальное клеймо. Если клеймо верное, можно принять это предупреждение.',
  ]

  return {
    kind: 'percentage-line-control',
    key: getPercentageLineNewWelderWarningKey(summary.key),
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
    ? 'Назначить 100% контроль по клейму'
    : summary.stamp ? 'Назначить контроль по процентной линии' : 'Назначить 100% контроль линии'
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%${summary.stamp ? `, клеймо ${summary.stamp}` : ', по всей линии'}.`,
    summary.fullControlRequired
      ? `По клейму уже ${summary.rejectedControlRows} первичных стыков с негодным РК/УЗК (собственным, до ТО при включённом этапе или дублем), поэтому требуется контроль всех ${summary.officialJointCount} физических соединений этого клейма. Ремонты и переварки не добавляют добор.`
      : `По расчету требуется ${summary.calculatedRequiredControls} стык(ов) контроля: базово ${summary.baseRequiredControls}, дополнительно ${summary.additionalRequiredControls}.`,
    summary.availableRequiredControls < summary.calculatedRequiredControls
      ? `Доступно для закрытия ${summary.availableRequiredControls} стык(ов), поэтому к закрытию берется ${summary.requiredControls}.`
      : `К закрытию берется ${summary.requiredControls} стык(ов).`,
    `Закрыто расчетом ${summary.coveredControls}, осталось закрыть ${summary.missingControls}.`,
  ]
  if (summary.missingCandidateJointNames.length > 0) {
    detailParts.push(`Кандидаты без закрытия расчета: ${formatJointList(summary.missingCandidateJointNames)}.`)
  }
  detailParts.push(
    'Общую потребность закрывают РК/УЗК с «да» или «дополнительный», для У также явно назначенная послойная замена. Один стык учитывается один раз. Обычный ПВК закрывает только самостоятельную норму ПВК. Совместная отмена РК+УЗК учитывается только для С.',
    'Если стык уже имеет негодный результат по любому контролю, он не попадает в кандидаты на новое назначение.',
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
    fullControlRequired: summary.fullControlRequired,
  }
}

function buildExcessControlTask(row: WeldRow, summary: PercentageLineStampSummary): PercentageLineControlTask {
  const accounting = getProgramDemandAccounting(summary.common)
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%${summary.stamp ? `, клеймо ${summary.stamp}` : ', по всей линии'}.`,
    `По расчету требуется ${summary.requiredControls} стык(ов) контроля, зачтено ${summary.coveredControls}. Назначено: ${formatProgramAssignmentAccounting(accounting.assignments)}.`,
    `Лишних обычных "да": ${summary.excessControls}.`,
  ]
  if (summary.excessCandidateJointNames.length > 0) {
    detailParts.push(`Проверь назначенные стыки: ${formatJointList(summary.excessCandidateJointNames)}.`)
  }
  detailParts.push('«Доп» закрывает норму и может сделать обычное «да» на другом стыке лишним. Сам «доп» не лишний. Проверьте назначения в программе линии: ненужное «да» можно снять через «Пусто», если нет защищённой истории. Дополнительный контроль сохраняйте только если он действительно нужен.')

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:excess:${summary.key}:${summary.requiredControls}:${summary.normalAssignedControls}:${toTaskKeyPart(summary.excessCandidateRowIds)}`,
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

function buildRejectedRowsControlTask(row: WeldRow, summary: PercentageLineStampSummary): PercentageLineControlTask {
  const rejectedNames = summary.rejectedJointNames
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%${summary.stamp ? `, клеймо ${summary.stamp}` : ', по всей линии'}.`,
    `Найдено ${summary.rejectedControlRows} официальных актуальных первичных стыков С/У с негодным РК/УЗК. Учитываются собственный контроль, включённый НК до ТО и дубли; источник считается один раз по каждому своему официальному клейму. Ремонты, переварки, ВИК и ПВК добор не увеличивают.`,
  ]
  if (rejectedNames.length > 0) {
    detailParts.push(`Проверь официальность стыков: ${formatJointList(rejectedNames)}.`)
  }
  detailParts.push('Если стык должен быть неофициальным, измени официальность через меню ЛНК. Это влияет на расчет процентной линии и дальнейший объем контроля.')

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:rejected-rows:${summary.key}:${summary.rejectedControlRows}:${toTaskKeyPart(summary.rejectedRowIds)}`,
    row,
    issue: 'rejected-rows',
    projectTitle: summary.projectTitle,
    subtitleCode: summary.subtitleCode,
    line: summary.line,
    stamp: summary.stamp,
    title: 'Проверить официальность на процентной линии',
    details: detailParts.join(' '),
    targetRowIds: summary.rejectedRowIds,
    requiredControls: summary.requiredControls,
    coveredControls: summary.coveredControls,
    assignedControls: summary.assignedControls,
    count: summary.rejectedControlRows,
  }
}

function buildSuspendWelderTask(
  row: WeldRow,
  summary: PercentageLineStampSummary,
  suspensionFrom: string,
): PercentageLineControlTask {
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%${summary.stamp ? `, клеймо ${summary.stamp}` : ', по всей линии'}.`,
    `По клейму найдено ${summary.rejectedControlRows} первичных стыков С/У с негодным РК/УЗК: ${formatJointList(summary.rejectedJointNames)}. Учитываются собственный контроль, включённый НК до ТО и дубли. Ремонты и переварки исключены.`,
    'После четвёртой отдельной негодной записи этого клейма требуется полный контроль и решение об отстранении сварщика.',
    suspensionFrom
      ? `Дату начала отстранения диспетчер предлагает взять по дате контроля четвертого негодного стыка: ${formatDisplayDate(suspensionFrom)}.`
      : 'Дату начала отстранения нужно определить по дате контроля четвертого негодного стыка.',
  ]

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:suspend-welder:${summary.key}:${summary.rejectedControlRows}:${toTaskKeyPart(summary.rejectedRowIds)}`,
    row,
    issue: 'suspend-welder',
    projectTitle: summary.projectTitle,
    subtitleCode: summary.subtitleCode,
    line: summary.line,
    stamp: summary.stamp,
    title: 'Отстранить сварщика от работы',
    details: detailParts.join(' '),
    targetRowIds: summary.rejectedRowIds,
    suspensionFrom,
    requiredControls: summary.requiredControls,
    coveredControls: summary.coveredControls,
    assignedControls: summary.assignedControls,
    count: summary.rejectedControlRows,
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

function compareRejectedRows(left: WeldRow, right: WeldRow) {
  return (
    compareDateLike(getRejectedControlEventDate(left), getRejectedControlEventDate(right)) ||
    compareDateLike(left.weldDate, right.weldDate) ||
    Number(left.id ?? 0) - Number(right.id ?? 0)
  )
}

function getRejectedControlEventDate(row: WeldRow) {
  const applicableCodes = new Set(['РК', 'УЗК'])
  const rejectedDates = LNK_METHODS.filter((method) => applicableCodes.has(method.code)).flatMap((method) => {
    const result = normalizeResultStatus(row[method.resultKey])
    if (result !== 'ремонт' && result !== 'вырез') return []
    const date = String(row[method.conclusionDateKey] ?? '').trim()
    return date ? [date] : []
  })
  const rejectedDuplicateDates = getRejectedDuplicateControls(row).flatMap((control) => {
    if (!applicableCodes.has(control.method)) return []
    return control.conclusionDate || control.controlDate ? [control.conclusionDate || control.controlDate] : []
  })
  const rejectedPreHeatTreatmentDates = (isPreHeatTreatmentStageEnabled(row) ? row.preHeatTreatmentControls ?? [] : []).flatMap((control) => {
    if (!applicableCodes.has(control.method) || !['ремонт', 'вырез'].includes(normalizeResultStatus(control.result) ?? '')) return []
    const date = String(control.conclusionDate ?? '').trim()
    return date ? [date] : []
  })

  const validRejectedDates = [
    ...rejectedDates,
    ...rejectedPreHeatTreatmentDates,
    ...rejectedDuplicateDates,
  ].flatMap((value) => {
    const date = parseDateLikeToIso(value)
    return date ? [date] : []
  })
  return validRejectedDates.sort()[0] ?? parseDateLikeToIso(row.weldDate) ?? ''
}

function compareDateLike(left: unknown, right: unknown) {
  const leftDate = parseDateLikeToIso(left)
  const rightDate = parseDateLikeToIso(right)
  if (!leftDate && !rightDate) return 0
  if (!leftDate) return 1
  if (!rightDate) return -1
  return leftDate.localeCompare(rightDate)
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
