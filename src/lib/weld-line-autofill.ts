import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { yesEmptyFieldKeys } from '@/lib/weld-form-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildLineConsistencyTasks } from '@/lib/line-consistency-tasks'

type WeldLineInput = WeldInput & { id?: number }

export type WeldLineAutofillState = {
  line: string
  sourceRowsCount: number
  values: Partial<WeldInput>
  changedFieldsCount: number
  disabledReason: string | null
  conflictLabels: string[]
}

type LineSourceRowsResult = {
  rows: WeldLineInput[]
  filterLabels: string[]
}

const LINE_AUTOFILL_FIELD_KEYS = [
  'projectTitle',
  'subtitleCode',
  'groupName',
  'category',
  'weldControlPercent',
  ...yesEmptyFieldKeys,
] as readonly WeldFieldKey[]

export function getWeldLineAutofillState(draft: WeldLineInput, rows: readonly WeldLineInput[]): WeldLineAutofillState {
  const line = normalizeDisplayValue(draft.line)
  if (!line) {
    return createDisabledState('', 'Сначала укажите линию.')
  }

  const sourceRowsResult = getLineSourceRows(draft, rows, line)
  const sourceRows = sourceRowsResult.rows
  if (sourceRows.length === 0) {
    const suffix = sourceRowsResult.filterLabels.length > 0 ? ` и ${sourceRowsResult.filterLabels.join(' + ')}` : ''
    return createDisabledState(line, `Нет других стыков с такой линией${suffix}.`)
  }

  const ambiguityLabels = getAmbiguousSourceLabels(draft, sourceRows)
  if (ambiguityLabels.length > 0) {
    return {
      line,
      sourceRowsCount: sourceRows.length,
      values: {},
      changedFieldsCount: 0,
      disabledReason: `Уточните ${ambiguityLabels.join(' и ')} для выбора источника по линии.`,
      conflictLabels: ambiguityLabels,
    }
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

  const values = normalizeAutofillValuesByControlPercent(getDominantLineValues(sourceRows), draft)
  const changedFieldsCount = Object.entries(values).filter(([key, value]) => normalizeCompareValue(draft[key as WeldFieldKey]) !== normalizeCompareValue(value)).length

  return {
    line,
    sourceRowsCount: sourceRows.length,
    values,
    changedFieldsCount,
    disabledReason: null,
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

function getLineSourceRows(draft: WeldLineInput, rows: readonly WeldLineInput[], line: string): LineSourceRowsResult {
  const lineKey = normalizeCompareValue(line)
  const currentId = typeof draft.id === 'number' ? draft.id : null

  let sourceRows = rows.filter((row) => {
    if (currentId !== null && row.id === currentId) return false
    if (normalizeCompareValue(row.line) !== lineKey) return false
    return true
  })

  const filterLabels: string[] = []
  for (const key of ['projectTitle', 'subtitleCode'] satisfies WeldFieldKey[]) {
    const draftValue = normalizeCompareValue(draft[key])
    if (!draftValue) continue

    const matchingRows = sourceRows.filter((row) => normalizeCompareValue(row[key]) === draftValue)
    if (matchingRows.length === 0) {
      filterLabels.push(FIELD_BY_KEY.get(key)?.label ?? key)
      return { rows: [], filterLabels }
    }

    sourceRows = matchingRows
    filterLabels.push(FIELD_BY_KEY.get(key)?.label ?? key)
  }

  return { rows: sourceRows, filterLabels }
}

function getLineConflictLabels(rows: readonly WeldLineInput[]) {
  return [...new Set(buildLineConsistencyTasks(toWeldRows(rows)).map((task) => task.fieldLabel))]
}

function getAmbiguousSourceLabels(draft: WeldLineInput, rows: readonly WeldLineInput[]) {
  return (['projectTitle', 'subtitleCode'] satisfies WeldFieldKey[])
    .filter((key) => {
      if (normalizeCompareValue(draft[key])) return false
      return getDistinctNonEmptyValues(rows, key).length > 1
    })
    .map((key) => FIELD_BY_KEY.get(key)?.label ?? key)
}

function getDistinctNonEmptyValues(rows: readonly WeldLineInput[], key: WeldFieldKey) {
  const values = new Map<string, string>()
  for (const row of rows) {
    const displayValue = normalizeDisplayValue(row[key])
    if (!displayValue) continue
    const compareValue = normalizeCompareValue(displayValue)
    if (!values.has(compareValue)) values.set(compareValue, displayValue)
  }
  return [...values.values()]
}

function getDominantLineValues(rows: readonly WeldLineInput[]) {
  const values: Partial<WeldInput> = {}
  for (const key of LINE_AUTOFILL_FIELD_KEYS) {
    const value = getUnambiguousValue(rows, key)
    if (!isEmptyValue(value)) values[key] = value
  }
  return values
}

function getUnambiguousValue(rows: readonly WeldLineInput[], key: WeldFieldKey) {
  const variants = new Map<string, WeldInput[WeldFieldKey]>()
  for (const row of rows) {
    const value = row[key]
    if (isEmptyValue(value)) continue

    const compareValue = normalizeCompareValue(value)
    if (variants.has(compareValue)) continue

    variants.set(compareValue, value)
  }

  return variants.size === 1 ? [...variants.values()][0] : undefined
}

function normalizeAutofillValuesByControlPercent(values: Partial<WeldInput>, draft: WeldLineInput) {
  const percentValue = values.weldControlPercent ?? draft.weldControlPercent
  if (!isPercentageLinePercent(percentValue)) return values

  const normalizedValues = { ...values }
  for (const key of yesEmptyFieldKeys as Set<WeldFieldKey>) {
    delete normalizedValues[key]
  }
  normalizedValues.hasVik = 'да'

  return normalizedValues
}

function isPercentageLinePercent(value: unknown) {
  const normalized = normalizeDisplayValue(value).replace(',', '.').replace('%', '')
  if (!normalized) return false
  const percent = Number(normalized)
  return Number.isFinite(percent) && percent > 0 && percent < 100
}

function toWeldRows(rows: readonly WeldLineInput[]): WeldRow[] {
  return rows.map((row, index) => ({ ...row, id: typeof row.id === 'number' ? row.id : -index - 1 }) as WeldRow)
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
