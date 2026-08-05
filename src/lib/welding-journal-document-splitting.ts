import type { WeldInput } from '@/lib/weld-fields'
import { hasDocumentSequenceNumberToken } from '@/lib/generated-document-naming'

export const WELDING_JOURNAL_DOCUMENT_SPLIT_MODES = [
  { value: 'project', label: 'Проект' },
  { value: 'subtitle', label: 'Шифр' },
  { value: 'line', label: 'Линия' },
  { value: 'joint', label: 'Стык' },
] as const

export type WeldingJournalDocumentSplitMode = (typeof WELDING_JOURNAL_DOCUMENT_SPLIT_MODES)[number]['value']

type SplitRecord = Pick<WeldInput, 'projectTitle' | 'subtitleCode' | 'line' | 'joint'>

export function isWeldingJournalDocumentSplitMode(value: unknown): value is WeldingJournalDocumentSplitMode {
  return WELDING_JOURNAL_DOCUMENT_SPLIT_MODES.some((mode) => mode.value === value)
}

export function splitWeldingJournalRecords<T extends SplitRecord>(
  records: T[],
  splitMode: WeldingJournalDocumentSplitMode,
): T[][] {
  if (splitMode === 'joint') return records.map((record) => [record])

  const groups = new Map<string, { values: string[]; records: T[] }>()
  for (const record of records) {
    const values = getSplitValues(record, splitMode)
    const key = JSON.stringify(values)
    const existing = groups.get(key)
    if (existing) {
      existing.records.push(record)
    } else {
      groups.set(key, { values, records: [record] })
    }
  }

  return [...groups.values()]
    .sort((left, right) => compareSplitValues(left.values, right.values))
    .map((group) => group.records)
}

export function makeUniqueDocumentNames(names: string[]) {
  const normalizedNames = names.map((name) => name.trim() || 'Сварочный журнал')
  const totals = new Map<string, number>()
  for (const name of normalizedNames) {
    const key = normalizeNameKey(name)
    totals.set(key, (totals.get(key) ?? 0) + 1)
  }

  const indexes = new Map<string, number>()
  return normalizedNames.map((name) => {
    const key = normalizeNameKey(name)
    if ((totals.get(key) ?? 0) < 2) return name
    if (hasDocumentSequenceNumberToken(name)) return name

    const index = (indexes.get(key) ?? 0) + 1
    indexes.set(key, index)
    return `${name} (${index})`
  })
}

function getSplitValues(record: SplitRecord, splitMode: Exclude<WeldingJournalDocumentSplitMode, 'joint'>) {
  const project = normalizeSplitValue(record.projectTitle)
  if (splitMode === 'project') return [project]

  const subtitle = normalizeSplitValue(record.subtitleCode)
  if (splitMode === 'subtitle') return [project, subtitle]

  return [project, subtitle, normalizeSplitValue(record.line)]
}

function normalizeSplitValue(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeNameKey(value: string) {
  return value.trim().toLocaleLowerCase('ru')
}

function compareSplitValues(left: string[], right: string[]) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const result = (left[index] ?? '').localeCompare(right[index] ?? '', 'ru', { numeric: true })
    if (result !== 0) return result
  }
  return 0
}
