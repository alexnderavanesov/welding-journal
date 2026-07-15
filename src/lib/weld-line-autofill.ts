import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { yesEmptyFieldKeys } from '@/lib/weld-form-utils'

export type WeldLineAutofillState = {
  line: string
  sourceRowsCount: number
  values: Partial<WeldInput>
  changedFieldsCount: number
  disabledReason: string | null
  conflictLabels: string[]
}

const LINE_AUTOFILL_FIELD_KEYS = [
  'projectTitle',
  'subtitleCode',
  'groupName',
  'category',
  'weldControlPercent',
  ...yesEmptyFieldKeys,
] as readonly WeldFieldKey[]

export function getWeldLineAutofillState(draft: WeldInput, rows: readonly WeldInput[]): WeldLineAutofillState {
  const line = normalizeDisplayValue(draft.line)
  if (!line) {
    return createDisabledState('', 'Сначала укажите линию.')
  }

  const sourceRows = getLineSourceRows(draft, rows, line)
  if (sourceRows.length === 0) {
    return createDisabledState(line, 'Нет других стыков с такой линией.')
  }

  const conflictLabels = getLineConflictLabels(sourceRows)
  if (conflictLabels.length > 0) {
    return {
      line,
      sourceRowsCount: sourceRows.length,
      values: {},
      changedFieldsCount: 0,
      disabledReason: `По линии есть разные значения: ${conflictLabels.join(', ')}.`,
      conflictLabels,
    }
  }

  const values = getDominantLineValues(sourceRows)
  const changedFieldsCount = Object.entries(values).filter(([key, value]) => normalizeCompareValue(draft[key as WeldFieldKey]) !== normalizeCompareValue(value)).length

  return {
    line,
    sourceRowsCount: sourceRows.length,
    values,
    changedFieldsCount,
    disabledReason: changedFieldsCount > 0 ? null : 'Данные по линии уже заполнены.',
    conflictLabels: [],
  }
}

function createDisabledState(line: string, disabledReason: string): WeldLineAutofillState {
  return {
    line,
    sourceRowsCount: 0,
    values: {},
    changedFieldsCount: 0,
    disabledReason,
    conflictLabels: [],
  }
}

function getLineSourceRows(draft: WeldInput, rows: readonly WeldInput[], line: string) {
  const lineKey = normalizeCompareValue(line)
  const projectKey = normalizeCompareValue(draft.projectTitle)
  const subtitleKey = normalizeCompareValue(draft.subtitleCode)
  const currentId = typeof draft.id === 'number' ? draft.id : null

  return rows.filter((row) => {
    if (currentId !== null && row.id === currentId) return false
    if (normalizeCompareValue(row.line) !== lineKey) return false
    if (projectKey && normalizeCompareValue(row.projectTitle) !== projectKey) return false
    if (subtitleKey && normalizeCompareValue(row.subtitleCode) !== subtitleKey) return false
    return true
  })
}

function getLineConflictLabels(rows: readonly WeldInput[]) {
  return LINE_AUTOFILL_FIELD_KEYS.filter((key) => getDistinctValues(rows, key).length > 1).map((key) => FIELD_BY_KEY.get(key)?.label ?? key)
}

function getDistinctValues(rows: readonly WeldInput[], key: WeldFieldKey) {
  const values = new Map<string, string>()
  for (const row of rows) {
    const displayValue = normalizeDisplayValue(row[key]) || 'пусто'
    const compareValue = normalizeCompareValue(displayValue)
    if (!values.has(compareValue)) values.set(compareValue, displayValue)
  }
  return [...values.values()]
}

function getDominantLineValues(rows: readonly WeldInput[]) {
  const values: Partial<WeldInput> = {}
  for (const key of LINE_AUTOFILL_FIELD_KEYS) {
    const value = getDominantValue(rows, key)
    if (!isEmptyValue(value)) values[key] = value
  }
  return values
}

function getDominantValue(rows: readonly WeldInput[], key: WeldFieldKey) {
  const variants = new Map<string, { value: WeldInput[WeldFieldKey]; count: number; lastIndex: number }>()
  rows.forEach((row, index) => {
    const value = row[key]
    if (isEmptyValue(value)) return

    const compareValue = normalizeCompareValue(value)
    const current = variants.get(compareValue)
    if (current) {
      current.count += 1
      current.lastIndex = index
      return
    }

    variants.set(compareValue, { value, count: 1, lastIndex: index })
  })

  return [...variants.values()].sort((left, right) => right.count - left.count || right.lastIndex - left.lastIndex)[0]?.value
}

function isEmptyValue(value: unknown) {
  return normalizeDisplayValue(value) === ''
}

function normalizeDisplayValue(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeCompareValue(value: unknown) {
  return normalizeDisplayValue(value).toLocaleLowerCase('ru')
}
