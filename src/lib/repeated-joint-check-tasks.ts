import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { LNK_METHODS, REPAIR_FORBIDDEN_BY_DIAMETER_REASON, WELD_STAMP_COMPLETION_GROUPS } from '@/lib/report-config'
import { hasText } from '@/lib/report-value-utils'
import { formatDisplayDate } from '@/lib/date-format'
import { isDateBeforeWeldDate } from '@/lib/report-date-rules'
import { parseJointChainName } from '@/lib/joint-chain'
import { formatJointDiameterLabel, isUnofficialJoint } from '@/lib/joint-display'
import { isLnkRepairForbiddenByDiameter } from '@/lib/lnk-result-rules'
import { getDispatcherLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { getDispatcherPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { formatOfficialStampCompatibilityIssue, getOfficialStampCompatibilityIssues } from '@/lib/welder-stamp-compatibility'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import type { RepeatedJointCheckTask, WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export function buildControlDateBeforeWeldDateCheckTasks(rows: WeldRow[]): RepeatedJointCheckTask[] {
  const tasks: RepeatedJointCheckTask[] = []
  for (const row of rows) {
    const issues = getControlDateBeforeWeldDateIssues(row)
    if (issues.length === 0) continue
    const joint = String(row.joint ?? '').trim() || '-'
    const details = issues
      .map(
        (issue) =>
          `${issue.label}: ${formatDisplayDate(issue.date) || '-'} раньше даты сварки стыка ${joint} (${formatDisplayDate(row.weldDate) || '-'}).`,
      )
      .join(' ')
    tasks.push(
      createJointChainCheckTask(
        row,
        `${getJointChainConsistencyKey(row) ?? row.id}:control-before-weld:${row.id}`,
        'проверить дату сварки и контроля',
        `${details} Проверь дату сварки или дату ${issues.length === 1 ? formatDateIssueLabelForSuggestion(issues[0].label) : 'контроля/ПСТО'}.`,
      ),
    )
  }
  return tasks
}

export function buildForbiddenRepairByDiameterCheckTasks(rows: WeldRow[]): RepeatedJointCheckTask[] {
  const tasks: RepeatedJointCheckTask[] = []
  for (const row of rows) {
    if (!isLnkRepairForbiddenByDiameter(row)) continue

    const repairMethods = LNK_METHODS.filter(
      (method) => String(row[method.resultKey] ?? '').trim().toLowerCase() === 'ремонт',
    )
    if (repairMethods.length === 0) continue

    const joint = String(row.joint ?? '').trim() || '-'
    const methodCodes = repairMethods.map((method) => method.code).join(', ')
    const diameterText = formatJointDiameterLabel(row)
    tasks.push(
      createJointChainCheckTask(
        row,
        `${getJointChainConsistencyKey(row) ?? row.id}:repair-diameter:${row.id}:${repairMethods
          .map((method) => method.resultKey)
          .join(',')}`,
        REPAIR_FORBIDDEN_BY_DIAMETER_REASON,
        `Стык ${joint}: результат ${methodCodes} - ремонт указан при минимальном диаметре ${diameterText} мм. Ремонт на стыке с диаметром меньше 89 мм недопустим; для такого диаметра выбирается только "вырез". Проверь D1/D2 или результат контроля.`,
      ),
    )
  }
  return tasks
}

export function buildLnkChronologyCheckTasks(rows: WeldRow[]): RepeatedJointCheckTask[] {
  return getDispatcherLnkChronologyIssues(rows).map((issue) => {
    const row = issue.row as WeldRow
    return createJointChainCheckTask(
      row,
      `${getJointChainConsistencyKey(row) ?? row.id}:lnk-chronology:${issue.kind}:${issue.methodCode}`,
      issue.reason,
      issue.message,
    )
  })
}

export function buildPstoChronologyCheckTasks(rows: WeldRow[]): RepeatedJointCheckTask[] {
  return getDispatcherPstoChronologyIssues(rows).map((issue) => {
    const row = issue.row as WeldRow
    return createJointChainCheckTask(
      row,
      `${getJointChainConsistencyKey(row) ?? row.id}:psto-chronology:${issue.kind}`,
      issue.reason,
      issue.message,
    )
  })
}

export function buildWelderStampCompatibilityCheckTasks(
  rows: WeldRow[],
  welderStampRecords: WelderStampRecord[],
  welderStampSuspensions: WelderStampSuspensionRecord[] = [],
): RepeatedJointCheckTask[] {
  if (welderStampRecords.length === 0 && welderStampSuspensions.length === 0) return []

  const tasks: RepeatedJointCheckTask[] = []
  for (const row of rows) {
    const issues = getOfficialStampCompatibilityIssues(row, welderStampRecords, {
      ignoreArchivedMissingRegistry: true,
      suspensions: welderStampSuspensions,
    })
    if (issues.length === 0) continue

    const joint = String(row.joint ?? '').trim() || '-'
    const hasSuspensionIssue = issues.some((issue) => issue.reason === 'suspended')
    const details = [
      `Стык ${joint}: ${issues.map(formatOfficialStampCompatibilityIssue).join(' ')}`,
      hasSuspensionIssue
        ? 'Проверь дату сварки или период отстранения в истории отстранений.'
        : 'Проверь официальное клеймо, НАКС, ДЛС, способ сварки, группу материалов, D1/D2, T1/T2, дату сварки или срок действия допуска в реестре клейм.',
    ].join(' ')

    tasks.push(
      createJointChainCheckTask(
        row,
        `${getJointChainConsistencyKey(row) ?? row.id}:welder-stamp:${row.id}:${issues
          .map((issue) => `${issue.fieldKey}:${issue.stamp}:${issue.method}:${issue.reason}`)
          .join('|')}`,
        'проверить клеймо',
        details,
      ),
    )
  }

  return tasks
}

export function buildIncompleteWelderStampGroupTasks(rows: WeldRow[]): RepeatedJointCheckTask[] {
  const tasks: RepeatedJointCheckTask[] = []
  const allStampFields = WELD_STAMP_COMPLETION_GROUPS.flatMap((group) => group.fields)
  for (const row of rows) {
    const filledStampFields = allStampFields.filter((fieldKey) => hasText(row[fieldKey]))
    const hasWeldDate = hasText(row.weldDate)
    const joint = String(row.joint ?? '').trim() || '-'
    const officialityText = isUnofficialJoint(row) ? ' (неофициальный)' : ''

    if (!hasWeldDate && filledStampFields.length > 0) {
      const filledText = filledStampFields.map(formatWeldStampCompletionFieldLabel).join(', ')
      tasks.push(
        createJointChainCheckTask(
          row,
          `${getJointChainConsistencyKey(row) ?? row.id}:weld-date-required-by-stamps:${row.id}`,
          'дозаполнить дату сварки',
          `Стык ${joint}${officialityText}: заполнены клейма (${filledText}), но дата сварки не заполнена. Если клейма уже указаны, нужно дозаполнить дату сварки.`,
        ),
      )
      continue
    }

    if (hasWeldDate && filledStampFields.length === 0) {
      const weldDateText = formatDisplayDate(row.weldDate) || '-'
      const group = WELD_STAMP_COMPLETION_GROUPS[0]
      tasks.push(
        createJointChainCheckTask(
          row,
          `${getJointChainConsistencyKey(row) ?? row.id}:weld-stamp-completion-empty-${group.index}:${row.id}`,
          group.reason,
          `Стык ${joint}${officialityText}: дата сварки ${weldDateText} заполнена, но клейма не заполнены. Нужно дозаполнить группу клейма_${group.index}.`,
        ),
      )
      continue
    }

    for (const group of WELD_STAMP_COMPLETION_GROUPS) {
      const filledFields = group.fields.filter((fieldKey) => hasText(row[fieldKey]))
      if (filledFields.length === 0 || filledFields.length === group.fields.length) continue

      const missingFields = group.fields.filter((fieldKey) => !hasText(row[fieldKey]))
      const filledText = filledFields.map(formatWeldStampCompletionFieldLabel).join(', ')
      const missingText = missingFields.map(formatWeldStampCompletionFieldLabel).join(', ')
      tasks.push(
        createJointChainCheckTask(
          row,
          `${getJointChainConsistencyKey(row) ?? row.id}:weld-stamp-completion-${group.index}:${row.id}:${missingFields.join(',')}`,
          group.reason,
          `Стык ${joint}${officialityText}: в группе клейма_${group.index} заполнено ${filledText}, но не заполнено ${missingText}. Если в группе заполнено хотя бы одно клеймо, нужно дозаполнить остальные поля этой группы.`,
        ),
      )
    }
  }
  return tasks
}

export function isIncompleteWeldStampGroupReason(reason?: string) {
  return reason === 'дозаполнить клейма_1' || reason === 'дозаполнить клейма_2' || reason === 'дозаполнить дату сварки'
}

export function createJointChainCheckTask(row: WeldRow, key: string, reason: string, details?: string): RepeatedJointCheckTask {
  const sourceJoint = String(row.joint ?? '').trim()
  const baseJoint = parseJointChainName(sourceJoint).base || sourceJoint
  return {
    kind: 'check',
    key: `check-chain:${key}:${reason}:${row.id}`,
    row,
    sourceRow: row,
    sourceJoint,
    targetJoint: sourceJoint,
    baseJoint,
    suffix: 'R',
    reason,
    details,
  }
}

function formatWeldStampCompletionFieldLabel(fieldKey: WeldFieldKey) {
  return FIELD_BY_KEY.get(fieldKey)?.label ?? fieldKey
}

function formatDateIssueLabelForSuggestion(label: string) {
  const normalizedLabel = label.trim().toLowerCase()
  if (normalizedLabel.startsWith('дата ')) return normalizedLabel.slice('дата '.length)
  return normalizedLabel
}

function getControlDateBeforeWeldDateIssues(row: WeldInput) {
  const issues: Array<{ label: string; date: unknown }> = []
  for (const method of LNK_METHODS) {
    if (!hasText(row[method.resultKey]) || !hasText(row[method.conclusionDateKey])) continue
    if (isDateBeforeWeldDate(row[method.conclusionDateKey], row.weldDate)) {
      issues.push({ label: `Дата контроля ${method.code}`, date: row[method.conclusionDateKey] })
    }
  }
  if (hasText(row.pstoResult) && hasText(row.pstoDate) && isDateBeforeWeldDate(row.pstoDate, row.weldDate)) {
    issues.push({ label: 'Дата ПСТО', date: row.pstoDate })
  }
  return issues
}
