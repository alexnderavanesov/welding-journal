import { buildPercentageLineSummaries, type PercentageLineStampSummary } from '@/lib/percentage-line-summary'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import type { PercentageLineControlTask, WeldRow } from '@/lib/dispatcher-types'

export function buildPercentageLineControlTasks(rows: WeldRow[]): PercentageLineControlTask[] {
  const tasks: PercentageLineControlTask[] = []

  for (const lineSummary of buildPercentageLineSummaries(rows)) {
    for (const stampSummary of lineSummary.stamps) {
      const sampleRow = findStampRow(lineSummary.rows, stampSummary.stamp) ?? lineSummary.rows[0]
      if (!sampleRow) continue

      if (stampSummary.missingControls > 0) {
        tasks.push(buildMissingControlTask(sampleRow, stampSummary))
      }

      if (stampSummary.excessControls > 0) {
        tasks.push(buildExcessControlTask(sampleRow, stampSummary))
      }

      if (stampSummary.rejectedPrimaryControls > 0) {
        tasks.push(buildRejectedPrimaryControlTask(sampleRow, stampSummary))
      }

      if (stampSummary.fullControlRequired) {
        tasks.push(buildSuspendWelderTask(sampleRow, stampSummary))
      }
    }
  }

  return tasks
}

function buildMissingControlTask(row: WeldRow, summary: PercentageLineStampSummary): PercentageLineControlTask {
  const title = summary.fullControlRequired
    ? 'Назначить 100% РК/УЗК по клейму'
    : 'Назначить РК/УЗК по процентной линии'
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%, клеймо ${summary.stamp}.`,
    summary.fullControlRequired
      ? `По клейму уже ${summary.rejectedPrimaryControls} первичных негодных стыков, поэтому требуется РК/УЗК для всех ${summary.officialJointCount} стыков этого клейма.`
      : `По расчету требуется ${summary.requiredControls} стык(ов) РК/УЗК: базово ${summary.baseRequiredControls}, дополнительно ${summary.additionalRequiredControls}.`,
    `Покрыто ${summary.coveredControls}, не хватает ${summary.missingControls}.`,
  ]
  if (summary.missingCandidateJointNames.length > 0) {
    detailParts.push(`Кандидаты без покрытия: ${formatJointList(summary.missingCandidateJointNames)}.`)
  }
  detailParts.push('Покрытием считается назначенный РК/УЗК, выполненный результат или осознанно проставленное "отменен".')

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
    `Лишних назначений: ${summary.excessControls}.`,
  ]
  if (summary.excessCandidateJointNames.length > 0) {
    detailParts.push(`Проверь назначенные стыки: ${formatJointList(summary.excessCandidateJointNames)}.`)
  }
  detailParts.push('Если контроль назначен осознанно сверх процента, используй статус "дополнительный", тогда диспетчер не будет считать его ошибкой.')

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:excess:${summary.key}:${summary.requiredControls}:${summary.assignedControls}`,
    row,
    issue: 'excess',
    projectTitle: summary.projectTitle,
    subtitleCode: summary.subtitleCode,
    line: summary.line,
    stamp: summary.stamp,
    title: 'Проверить лишний контроль процентной линии',
    details: detailParts.join(' '),
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
    `Найдено ${summary.rejectedPrimaryControls} первичных официальных стык(ов) с негодным РК/УЗК.`,
  ]
  if (rejectedNames.length > 0) {
    detailParts.push(`Проверь официальность стыков: ${formatJointList(rejectedNames)}.`)
  }
  detailParts.push('Если стык должен быть неофициальным, измени официальность через меню ЛНК. Это влияет на расчет процентной линии и дальнейший объем контроля.')

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:rejected-primary:${summary.key}:${summary.rejectedPrimaryControls}`,
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

function buildSuspendWelderTask(row: WeldRow, summary: PercentageLineStampSummary): PercentageLineControlTask {
  const detailParts = [
    `Линия ${summary.line}, контроль ${summary.percent}%, клеймо ${summary.stamp}.`,
    `По клейму найдено ${summary.rejectedPrimaryControls} первичных негодных стыков: ${formatJointList(summary.rejectedPrimaryJointNames)}.`,
    'По правилу процентной линии после четвертого первичного негодного результата сварщика нужно отстранить от официальной сварки до отдельного решения.',
    'Механика отстранения будет оформлена в разделе "Клейма"; сейчас диспетчер показывает это как важное предупреждение.',
  ]

  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:suspend-welder:${summary.key}:${summary.rejectedPrimaryControls}`,
    row,
    issue: 'suspend-welder',
    projectTitle: summary.projectTitle,
    subtitleCode: summary.subtitleCode,
    line: summary.line,
    stamp: summary.stamp,
    title: 'Отстранить сварщика от работы',
    details: detailParts.join(' '),
    targetRowIds: summary.rejectedPrimaryRowIds,
    requiredControls: summary.requiredControls,
    coveredControls: summary.coveredControls,
    assignedControls: summary.assignedControls,
    count: summary.rejectedPrimaryControls,
  }
}

function findStampRow(rows: WeldRow[], stamp: string) {
  const normalizedStamp = normalizeValue(stamp)
  return rows.find((row) => OFFICIAL_WELDER_STAMP_FIELD_KEYS.some((key) => normalizeValue(row[key]) === normalizedStamp))
}

function formatJointList(values: string[]) {
  return values.slice(0, 8).join(', ') + (values.length > 8 ? ` и еще ${values.length - 8}` : '')
}

function normalizeValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}
