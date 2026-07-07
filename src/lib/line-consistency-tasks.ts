import type { LineConsistencyTask, WeldRow } from '@/lib/dispatcher-types'

type LineMetadataFieldKey = Exclude<LineConsistencyTask['fieldKey'], 'controlPresence'>

type LineConsistencyField = {
  key: LineMetadataFieldKey
  label: string
  title: string
}

type ControlPresenceField = {
  key: keyof WeldRow
  label: string
}

const LINE_CONSISTENCY_FIELDS: LineConsistencyField[] = [
  { key: 'weldControlPercent', label: 'Контроль швов, (%)', title: 'Проверить % контроля линии' },
  { key: 'groupName', label: 'Группа', title: 'Проверить группу линии' },
  { key: 'category', label: 'Категория', title: 'Проверить категорию линии' },
]

const CONTROL_PRESENCE_FIELDS: ControlPresenceField[] = [
  { key: 'hasVik', label: 'ВИК' },
  { key: 'hasRk', label: 'РК' },
  { key: 'hasPvk', label: 'ПВК' },
  { key: 'hasUzk', label: 'УЗК' },
  { key: 'pstoRequired', label: 'ПСТО' },
  { key: 'hasTvmt', label: 'ТВМТ' },
  { key: 'hasRfa', label: 'РФА' },
  { key: 'hasStls', label: 'СТЛС' },
  { key: 'hasMkk', label: 'МКК' },
]

export function buildLineConsistencyTasks(rows: WeldRow[]): LineConsistencyTask[] {
  const lineGroups = new Map<string, WeldRow[]>()
  for (const row of rows) {
    const line = normalizeDisplayValue(row.line)
    if (!line) continue
    const groupKey = [
      normalizeKey(row.projectTitle),
      normalizeKey(row.subtitleCode),
      normalizeKey(line),
    ].join(':')
    const group = lineGroups.get(groupKey)
    if (group) {
      group.push(row)
    } else {
      lineGroups.set(groupKey, [row])
    }
  }

  const tasks: LineConsistencyTask[] = []
  for (const groupRows of lineGroups.values()) {
    if (groupRows.length < 2) continue
    const representativeRow = groupRows[0]
    const line = normalizeDisplayValue(representativeRow.line)
    if (!line) continue

    for (const field of LINE_CONSISTENCY_FIELDS) {
      const values = getDistinctLineValues(groupRows, field.key)
      if (values.length < 2) continue
      const projectTitle = normalizeDisplayValue(representativeRow.projectTitle)
      const subtitleCode = normalizeDisplayValue(representativeRow.subtitleCode)
      const detailsContext = [
        projectTitle ? `проект ${projectTitle}` : '',
        subtitleCode ? `шифр ${subtitleCode}` : '',
      ].filter(Boolean).join(', ')
      const valuesText = values.join(', ')
      tasks.push({
        kind: 'line-consistency',
        key: `line-consistency:${field.key}:${normalizeKey(projectTitle)}:${normalizeKey(subtitleCode)}:${normalizeKey(line)}:${values.map(normalizeKey).join('|')}`,
        row: representativeRow,
        line,
        projectTitle,
        subtitleCode,
        fieldKey: field.key,
        fieldLabel: field.label,
        title: field.title,
        values,
        details: `На линии ${line}${detailsContext ? ` (${detailsContext})` : ''} встречаются разные значения в столбце «${field.label}»: ${valuesText}. Для одной линии значение должно быть одинаковым. Нажмите «Показать», чтобы отфильтровать все стыки этой линии и исправить некорректные строки.`,
      })
    }

    tasks.push(...buildControlPresenceTasksForLine(groupRows, representativeRow, line))
  }

  return tasks
}

function buildControlPresenceTasksForLine(groupRows: WeldRow[], representativeRow: WeldRow, line: string) {
  const percentGroups = new Map<string, WeldRow[]>()
  for (const row of groupRows) {
    const percent = normalizeDisplayValue(row.weldControlPercent) || 'пусто'
    const percentKey = normalizeKey(percent)
    const group = percentGroups.get(percentKey)
    if (group) {
      group.push(row)
    } else {
      percentGroups.set(percentKey, [row])
    }
  }

  const tasks: LineConsistencyTask[] = []
  for (const [percentKey, percentRows] of percentGroups.entries()) {
    if (percentRows.length < 2) continue
    const percent = normalizeDisplayValue(percentRows[0]?.weldControlPercent) || 'пусто'
    if (!isFullControlPercent(percent)) continue
    const values = getControlPresenceConflictValues(percentRows)
    if (values.length < 2) continue

    const projectTitle = normalizeDisplayValue(representativeRow.projectTitle)
    const subtitleCode = normalizeDisplayValue(representativeRow.subtitleCode)
    const detailsContext = [
      projectTitle ? `проект ${projectTitle}` : '',
      subtitleCode ? `шифр ${subtitleCode}` : '',
      `контроль швов (%) ${percent}`,
    ].filter(Boolean).join(', ')
    const valuesText = values.join(' / ')

    tasks.push({
      kind: 'line-consistency',
      key: `line-consistency:controlPresence:${normalizeKey(projectTitle)}:${normalizeKey(subtitleCode)}:${normalizeKey(line)}:${percentKey}:${values.map(normalizeKey).join('|')}`,
      row: representativeRow,
      line,
      projectTitle,
      subtitleCode,
      fieldKey: 'controlPresence',
      fieldLabel: 'Наличие контроля',
      title: 'Проверить наличие контроля линии',
      values,
      details: `На линии ${line}${detailsContext ? ` (${detailsContext})` : ''} встречаются разные наборы «да» в столбцах наличия контроля: ${valuesText}. Для одной линии с одинаковым % контроля набор видов контроля должен совпадать. Нажмите «Показать», чтобы отфильтровать все стыки этой линии и исправить некорректные строки.`,
    })
  }

  return tasks
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

function getControlPresenceConflictValues(rows: WeldRow[]) {
  const hasConflict = CONTROL_PRESENCE_FIELDS.some((field) => {
    let hasYes = false
    let hasNo = false
    for (const row of rows) {
      const value = row[field.key]
      if (isRequiredControlPresence(value)) {
        hasYes = true
      } else if (!isNeutralPresenceValue(value)) {
        hasNo = true
      }
      if (hasYes && hasNo) return true
    }
    return false
  })

  if (!hasConflict) return []

  const values = new Map<string, string>()
  for (const row of rows) {
    const labels = CONTROL_PRESENCE_FIELDS
      .filter((field) => isRequiredControlPresence(row[field.key]))
      .map((field) => field.label)
    const displayValue = labels.length ? labels.join(', ') : 'нет отмеченных видов контроля'
    const normalizedValue = labels.join('|') || 'none'
    if (!values.has(normalizedValue)) values.set(normalizedValue, displayValue)
  }
  return [...values.values()]
}

function isRequiredControlPresence(value: unknown) {
  const text = normalizeKey(value)
  return text === 'да' || text === 'yes' || text === 'true' || text === '1'
}

function isCancelledValue(value: unknown) {
  return normalizeKey(value) === 'отменен'
}

function isAdditionalValue(value: unknown) {
  return normalizeKey(value) === 'дополнительный'
}

function isNeutralPresenceValue(value: unknown) {
  return isCancelledValue(value) || isAdditionalValue(value) || normalizeKey(value) === 'замена рк/узк'
}

function normalizeDisplayValue(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeKey(value: unknown) {
  return normalizeDisplayValue(value).toLowerCase()
}

function isFullControlPercent(value: unknown) {
  const normalized = normalizeDisplayValue(value).replace(',', '.').replace('%', '')
  const percent = Number(normalized)
  return Number.isFinite(percent) && percent === 100
}
