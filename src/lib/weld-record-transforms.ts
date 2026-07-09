import type { WeldRow } from '@/lib/dispatcher-types'
import {
  FIELD_BY_KEY,
  EXCEL_FIELDS,
  FULL_EXCEL_HEADERS,
  type WeldFieldKey,
  type WeldInput,
  calculateFinalStatus,
} from './weld-fields'
import { emptyToNull, parseCell } from './weld-import-parsers'
import { formatControlAvailabilityForExport } from './report-value-utils'
import { normalizeControlAvailabilityText } from '@/lib/control-availability-values'

export function recordsToExportRows(records: WeldInput[]) {
  return records.map((record) => {
    const row: Record<string, string | number | boolean | null> = {}
    for (const field of EXCEL_FIELDS) {
      const value = record[field.key]
      if (field.kind === 'boolean') {
        row[field.label] = formatControlAvailabilityForExport(value)
      } else {
        row[field.label] = value ?? ''
      }
    }
    return row
  })
}

export function recordsToExportMatrix(records: WeldInput[]) {
  return [
    FULL_EXCEL_HEADERS,
    ...records.map((record) =>
      EXCEL_FIELDS.map((field) => {
        const value = record[field.key]
        if (field.kind === 'boolean') return formatControlAvailabilityForExport(value)
        return value ?? ''
      }),
    ),
  ]
}

export function normalizeWeldInput(input: WeldInput) {
  const normalized: WeldInput = {}
  for (const [key, value] of Object.entries(input)) {
    const field = FIELD_BY_KEY.get(key as WeldFieldKey)
    if (!field) continue
    normalized[field.key as keyof WeldInput] = parseCell(field, value)
  }
  const withAutoVik = withAutoVikForWeldDate(normalized)
  withAutoVik.finalStatus = calculateFinalStatus(withAutoVik)
  return withAutoVik
}

export function appendImportedWelds<T extends WeldRow>(existingRows: T[], importedRecords: WeldInput[]) {
  let nextId = existingRows.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const importedRows = importedRecords.map((record) => ({ id: nextId++, ...normalizeWeldInput(record) }))
  return [...importedRows, ...existingRows]
}

export function withAutoVikForWeldDate<T extends WeldInput>(record: T): T {
  const hasVikText = normalizeControlAvailabilityText(record.hasVik)
  if (hasVikText === 'отменен' || hasVikText === 'дополнительный') return record
  return emptyToNull(record.weldDate) === null ? record : ({ ...record, hasVik: true } as T)
}

export function getRequiredRootStampMessage(record: WeldInput) {
  if (emptyToNull(record.weldDate) === null || !isEmptyWeldStamp(record.stamp1K)) return null
  return 'укажите Корень_1: при заполненной дате сварки должно быть указано хотя бы одно клеймо.'
}

function isEmptyWeldStamp(value: unknown) {
  return normalizeWeldStamp(value) === ''
}

function normalizeWeldStamp(value: unknown) {
  const text = String(value ?? '').trim()
  return text.toLowerCase() === 'пусто' ? '' : text
}
