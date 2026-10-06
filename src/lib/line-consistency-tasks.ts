import type { LineConsistencyTask, WeldRow } from '@/lib/dispatcher-types'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import { isCancelledControlValue } from '@/lib/report-value-utils'
import { encodeIdentityKey } from '@/lib/identity-key'
import { calculateLineProgram, getLineProgramRowDemand, isLineProgramCalculationRow, isLineProgramControlRow, parseLineProgramPercent } from '@/lib/line-program-calculation'
import { programExcessEntries } from '@/lib/line-program-workspace'
import { programApprovalKey } from './program-control-approval'
import type { SystemIndexSettings } from './system-index-settings'
import { buildProgramRepairRequirements } from './line-program-repair-requirements'

type LineMetadataFieldKey = Exclude<LineConsistencyTask['fieldKey'], 'controlPresence' | 'pstoPresence'>

type LineConsistencyField = {
  key: LineMetadataFieldKey
  label: string
  title: string
}

const LINE_CONSISTENCY_FIELDS: LineConsistencyField[] = [
  { key: 'weldControlPercent', label: 'Контроль швов, (%)', title: 'Проверить % контроля линии' },
  { key: 'pvkControlPercent', label: 'ПВК, (%)', title: 'Проверить % ПВК линии' },
  { key: 'groupName', label: 'Группа трубопровода', title: 'Проверить группу трубопровода линии' },
  { key: 'category', label: 'Категория трубопровода', title: 'Проверить категорию трубопровода линии' },
]

export function buildLineConsistencyTasks(rows: WeldRow[], accepted: ReadonlySet<string> = new Set(), settings?: SystemIndexSettings): LineConsistencyTask[] {
  const lineGroups = new Map<string, WeldRow[]>()
  for (const row of rows) {
    const line = normalizeDisplayValue(row.line)
    if (!line) continue
    const groupKey = encodeIdentityKey([
      normalizeKey(row.projectTitle),
      normalizeKey(row.subtitleCode),
      normalizeKey(line),
    ])
    const group = lineGroups.get(groupKey)
    if (group) {
      group.push(row)
    } else {
      lineGroups.set(groupKey, [row])
    }
  }

  const tasks: LineConsistencyTask[] = []
  for (const groupRows of lineGroups.values()) {
    const representativeRow = groupRows[0]
    const line = normalizeDisplayValue(representativeRow.line)
    if (!line) continue

    for (const field of LINE_CONSISTENCY_FIELDS) {
      if (field.key === 'pvkControlPercent' && groupRows.every((row) => row.pvkControlPercent === undefined)) continue
      const values = getDistinctLineValues(groupRows, field.key)
      if (values.length < 2 && !values.includes('пусто')) continue
      const projectTitle = normalizeDisplayValue(representativeRow.projectTitle)
      const subtitleCode = normalizeDisplayValue(representativeRow.subtitleCode)
      const detailsContext = [
        projectTitle ? `проект ${projectTitle}` : '',
        subtitleCode ? `шифр ${subtitleCode}` : '',
      ].filter(Boolean).join(', ')
      const valuesText = values.join(', ')
      tasks.push({
        kind: 'line-consistency',
        key: `line-consistency:${field.key}:${encodeIdentityKey([
          normalizeKey(projectTitle),
          normalizeKey(subtitleCode),
          normalizeKey(line),
          ...values.map(normalizeKey),
        ])}`,
        row: representativeRow,
        line,
        projectTitle,
        subtitleCode,
        fieldKey: field.key,
        systemWarningCode: 'СП-02',
        fieldLabel: field.label,
        title: field.title,
        values,
        details: `На линии ${line}${detailsContext ? ` (${detailsContext})` : ''} не настроено единое значение «${field.label}»: ${valuesText}. Откройте «Программу линий» и настройте общие свойства линии.`,
      })
    }

    const mandatory = buildProgramRepairRequirements(groupRows, accepted, settings)
    let duplicateRows = groupRows.filter((row) =>
      (parseLineProgramPercent(row.weldControlPercent) === 100 ? isLineProgramControlRow(row) : isLineProgramCalculationRow(row)) &&
      !(mandatory.get(row.id)?.some(item => item.method === 'РК') && mandatory.get(row.id)?.some(item => item.method === 'УЗК')) &&
      getLineProgramRowDemand(row, 'common').duplicate && !accepted.has(programApprovalKey(row, 'common', true)))
    const lineId = representativeRow.lineProgramId
    const percent = parseLineProgramPercent(representativeRow.weldControlPercent)
    const pvkPercent = parseLineProgramPercent(representativeRow.pvkControlPercent)
    // Reuse exact program decisions, not a blanket acceptance of the line task.
    // Results/conclusions do not constitute approval and are never changed here.
    if (duplicateRows.length && accepted.size && lineId && percent != null && pvkPercent != null &&
      groupRows.every(row => row.lineProgramId === lineId) &&
      LINE_CONSISTENCY_FIELDS.every(field => { const values = getDistinctLineValues(groupRows, field.key); return values.length === 1 && !values.includes('пусто') })) {
      const entries = programExcessEntries(lineId, groupRows, calculateLineProgram(groupRows, percent, pvkPercent, settings, accepted))
      const approvals = new Map<number, boolean>()
      for (const entry of entries) if (entry.kind === 'common' && entry.duplicate) {
        approvals.set(entry.rowId, (approvals.get(entry.rowId) ?? true) && accepted.has(entry.key))
      }
      duplicateRows = duplicateRows.filter(row => !approvals.get(row.id))
    }
    if (duplicateRows.length) tasks.push({
      kind: 'line-consistency', key: `line-consistency:controlPresence:${encodeIdentityKey([representativeRow.projectTitle, representativeRow.subtitleCode, line])}`,
      row: duplicateRows[0], projectTitle: normalizeDisplayValue(representativeRow.projectTitle), subtitleCode: normalizeDisplayValue(representativeRow.subtitleCode), line,
      fieldKey: 'controlPresence', fieldLabel: 'Взаимозаменяемые назначения', title: 'Проверить лишние взаимозаменяемые назначения',
      values: duplicateRows.slice(0, 8).map((row) => String(row.joint ?? row.id)),
      details: 'На одном стыке несколько взаимозаменяемых назначений РК/УЗК/послойной замены либо обычное «да» дублирует уже выполненный отменённый метод. Один стык закрывает только одно место общей потребности, в том числе при 100%. «Да» вместе с «дополнительный» допустимо. Выполненный контроль не снимается; автоматической отмены нет.',
    })
    tasks.push(...buildPstoPresenceTasksForLine(groupRows, representativeRow, line))
  }

  return tasks
}

function buildPstoPresenceTasksForLine(groupRows: WeldRow[], representativeRow: WeldRow, line: string) {
  if (groupRows.length < 2) return []

  const rowsWithPsto = groupRows.filter((row) => isControlEnabledValue(row.pstoRequired))
  const rowsCancelled = groupRows.filter((row) => isCancelledControlValue(row.pstoRequired))
  const rowsWithoutPsto = groupRows.filter((row) => (
    !isControlEnabledValue(row.pstoRequired) && !isCancelledControlValue(row.pstoRequired)
  ))
  const nonEmptyStates = [rowsWithPsto, rowsCancelled, rowsWithoutPsto].filter((rows) => rows.length > 0)
  if (nonEmptyStates.length <= 1) return []
  const projectTitle = normalizeDisplayValue(representativeRow.projectTitle)
  const subtitleCode = normalizeDisplayValue(representativeRow.subtitleCode)
  const detailsContext = [
    projectTitle ? `проект ${projectTitle}` : '',
    subtitleCode ? `шифр ${subtitleCode}` : '',
  ].filter(Boolean).join(', ')
  const inconsistentRows = [...rowsCancelled, ...rowsWithoutPsto]
  const missingJoints = inconsistentRows
    .slice(0, 8)
    .map((row) => normalizeDisplayValue(row.joint) || `ID ${row.id}`)
    .join(', ')
  const extraText = inconsistentRows.length > 8 ? ` и еще ${inconsistentRows.length - 8}` : ''
  const values = [
    rowsWithPsto.length > 0 ? `ПСТО назначена: ${rowsWithPsto.length}` : '',
    rowsCancelled.length > 0 ? `ПСТО отменена: ${rowsCancelled.length}` : '',
    rowsWithoutPsto.length > 0 ? `Без ПСТО: ${rowsWithoutPsto.length}` : '',
  ].filter(Boolean)

  return [
    {
      kind: 'line-consistency',
      key: `line-consistency:pstoPresence:${encodeIdentityKey([
        normalizeKey(projectTitle),
        normalizeKey(subtitleCode),
        normalizeKey(line),
        rowsWithPsto.length,
        rowsCancelled.length,
        rowsWithoutPsto.length,
      ])}`,
      row: representativeRow,
      line,
      projectTitle,
      subtitleCode,
      fieldKey: 'pstoPresence',
      fieldLabel: 'ПСТО',
      title: 'Проверить ПСТО по линии',
      values,
      details: `На линии ${line}${detailsContext ? ` (${detailsContext})` : ''} встречаются разные состояния программы ПСТО: ${values.join(', ')}. Назначение или отмена должны действовать на всю связку Проект + Шифр + Линия. Проверьте стыки: ${missingJoints}${extraText}.`,
    } satisfies LineConsistencyTask,
  ]
}

function getDistinctLineValues(rows: WeldRow[], key: LineMetadataFieldKey) {
  const values = new Map<string, string>()
  for (const row of rows) {
    const displayValue = normalizeDisplayValue(row[key])
    const normalizedValue = normalizeKey(displayValue || 'пусто')
    if (!values.has(normalizedValue)) values.set(normalizedValue, displayValue || 'пусто')
  }
  return [...values.values()]
}

function normalizeDisplayValue(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeKey(value: unknown) {
  return normalizeDisplayValue(value).toLowerCase()
}
