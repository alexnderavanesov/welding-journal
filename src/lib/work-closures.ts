import { closureColumns, closureDimensions, closureListText, type ClosureDimension } from './work-closure-columns'
import { LNK_METHODS } from './lnk-report-config'

export type WorkClosure = { workType: string; rateCode: string; actNumber: string }
export type JointWorkClosure = WorkClosure & { weldJointId: number }
export type WorkClosureChange = { weldJointId: number; workType: string; before: WorkClosure | null; after: WorkClosure | null }
export type WorkClosureFilter = { workType?: string[]; rateCode?: string[]; rateAssigned?: boolean; actNumber?: string[]; actEmpty?: boolean; noWorks?: boolean }

export const preHeatWorkTypes = new Set(LNK_METHODS.map(method => method.code + ' до ТО'))
const reservedNames = new Set(['Сварка', 'ПСТО', 'ТВМТ', ...LNK_METHODS.map(method => method.code), ...preHeatWorkTypes]
  .map(name => name.toUpperCase()))

// Ordinary test names retain their existing stored identity. A test named like
// an NDT method still has its own position, rate and act on the same joint.
export function testClosureKey(name: string) {
  return reservedNames.has(name.toUpperCase()) ? 'Испытание · ' + name : name
}

export function workClosureTypeGroups(testTypes: readonly string[], beforeHeatTreatment: boolean) {
  const named = (label: string) => ({ value: label, label })
  return [
    { label: 'Сварка', options: [named('Сварка')] },
    { label: 'НК', options: LNK_METHODS.map(method => named(method.code)) },
    { label: 'ПСТО и ТВМТ', options: ['ПСТО', 'ТВМТ'].map(named) },
    { label: 'Испытания', options: testTypes.map(label => ({ value: testClosureKey(label), label })) },
    ...(beforeHeatTreatment ? [{ label: 'НК до ТО', options: [...preHeatWorkTypes].map(named) }] : []),
  ]
}

export function sameWorkClosure(left: WorkClosure | null, right: WorkClosure | null) {
  return left?.workType === right?.workType && left?.rateCode === right?.rateCode && left?.actNumber === right?.actNumber
}

export function replacedClosureFields(before: WorkClosure | null, after: WorkClosure) {
  return (['rateCode', 'actNumber'] as const).filter(field => before?.[field] && before[field] !== after[field])
}

export function normalizeWorkClosure(entry: WorkClosure): WorkClosure {
  if (!entry || [entry.workType, entry.rateCode, entry.actNumber].some(value => typeof value !== 'string')) throw new Error('Проверьте значения строки закрытия.')
  const workType = entry.workType.trim()
  if (!workType) throw new Error('Выберите вид работы.')
  return { workType, rateCode: entry.rateCode.trim(), actNumber: entry.actNumber.trim() }
}

export function jointClosureChanges(weldJointId: number, previous: WorkClosure[], draft: WorkClosure[]): WorkClosureChange[] {
  const before = new Map(previous.map(row => [row.workType, normalizeWorkClosure(row)]))
  const after = new Map<string, WorkClosure>()
  for (const entry of draft) {
    const row = normalizeWorkClosure(entry)
    if (after.has(row.workType)) throw new Error('Вид работы уже есть в этом стыке: ' + row.workType)
    after.set(row.workType, row)
  }
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(workType => {
    const old = before.get(workType) ?? null, next = after.get(workType) ?? null
    return sameWorkClosure(old, next) ? [] : [{ weldJointId, workType, before: old, after: next }]
  })
}

export function decodeWorkClosureFilter(value?: string): WorkClosureFilter {
  if (!value) return {}
  const filter = JSON.parse(value)
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw new Error('Некорректный фильтр закрытия работ.')
  const result: WorkClosureFilter = {}
  for (const key of ['workType', 'rateCode', 'actNumber'] as const) {
    const raw = filter[key]
    if (raw === undefined) continue
    // Existing browser views store a single string. An empty legacy field meant "all".
    const values: unknown[] = typeof raw === 'string' ? (raw.trim() ? [raw] : []) : raw
    if (!Array.isArray(values) || values.some(item => typeof item !== 'string')) throw new Error('Некорректный фильтр закрытия работ.')
    const selected = [...new Set((values as string[]).map(item => item.trim()).filter(item => item || key !== 'workType'))]
    if (selected.length) result[key] = selected
  }
  if (filter.noWorks === true) return { noWorks: true }
  if (filter.rateAssigned === true) result.rateAssigned = true
  if (filter.actEmpty === true) result.actEmpty = true
  return result
}

export function readClosureColumnFilters(columns: Record<string, string>): WorkClosureFilter {
  const filter = decodeWorkClosureFilter(columns.workClosureSummary)
  for (const dimension of ['rateCode', 'actNumber'] as const) {
    const value = columns[closureColumns[dimension].key]
    if (value) Object.assign(filter, decodeWorkClosureFilter(value))
  }
  if (filter.actEmpty) filter.actNumber = ['']
  delete filter.actEmpty
  return filter
}

export function withClosureColumnFilters(columns: Record<string, string>, filter: WorkClosureFilter) {
  const result = { ...columns }
  for (const dimension of closureDimensions) {
    const { key } = closureColumns[dimension]
    const part: WorkClosureFilter = {}
    if (filter[dimension]?.length && !filter.noWorks) part[dimension] = filter[dimension]
    if (dimension === 'workType' && filter.noWorks) part.noWorks = true
    if (dimension === 'rateCode' && filter.rateAssigned && !filter.noWorks) part.rateAssigned = true
    if (dimension === 'actNumber' && filter.actEmpty && !filter.noWorks) part.actNumber = ['']
    if (Object.keys(part).length) result[key] = JSON.stringify(part)
    else delete result[key]
  }
  return result
}

export function migrateClosureColumnFilters(columns: Record<string, string>) {
  return columns.workClosureSummary ? withClosureColumnFilters(columns, readClosureColumnFilters(columns)) : columns
}

const standardWorkOrder = new Map(workClosureTypeGroups([], false).flatMap(group => group.options)
  .map((option, index) => [option.value, index]))
const testOrder = standardWorkOrder.size
for (const type of preHeatWorkTypes) standardWorkOrder.set(type, standardWorkOrder.size + 1)
const nameOrder = new Intl.Collator('ru', { numeric: true })

export function compareClosureWorkTypes(left: string, right: string) {
  return (standardWorkOrder.get(left) ?? testOrder) - (standardWorkOrder.get(right) ?? testOrder) || nameOrder.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0)
}

export function closureValueLabel(dimension: ClosureDimension, value: string) {
  const empty = dimension === 'rateCode' ? 'Без кода' : 'Без КС3'
  if (!value) return empty
  return dimension !== 'workType' && value === empty ? '«' + value + '»' : value
}

export function closureDisplayFields(positions?: WorkClosure[] | null, format: 'report' | 'grid' = 'report') {
  if (!positions?.length) return {}
  const ordered = positions.slice().sort((a, b) => compareClosureWorkTypes(a.workType, b.workType))
  return Object.fromEntries(closureDimensions.map(dimension => {
    const values = ordered.map(position => position[dimension].replace(/[\r\n]+/g, ' ') || (dimension === 'rateCode' ? '—' : 'Без КС3'))
    // Newlines separate grid entries unambiguously, even for codes containing commas or numbers.
    return [closureColumns[dimension].key, format === 'grid' ? values.join('\n') : closureListText(values)]
  }))
}
