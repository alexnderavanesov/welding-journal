import {
  RESULT_FIELD_KEYS,
  type WeldField,
  normalizeFinalStatus,
  normalizeResultStatus,
} from './weld-fields'
import { normalizeDateLikeForStorage } from './date-format'

export function emptyToNull(value: unknown) {
  if (value === null || value === undefined) return null
  const normalized = String(value).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized === '' || normalized === '-' ? null : normalized
}

export function excelSerialDateToIso(value: number) {
  const epoch = Date.UTC(1899, 11, 30)
  const date = new Date(epoch + value * 86400000)
  return date.toISOString().slice(0, 10)
}

export function parseBoolean(value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return null
  const text = String(normalized).toLowerCase()
  if (['да', 'yes', 'true', '1', '+'].includes(text)) return true
  if (text === 'отменен') return 'отменен'
  if (text === 'дополнительный') return 'дополнительный'
  if (text === 'замена рк/узк') return 'дополнительный'
  if (['нет', 'no', 'false', '0', '-'].includes(text)) return false
  return Boolean(text)
}

export function parseNumber(value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return null
  const number = Number(String(normalized).replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

export function parseDate(value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return null
  if (typeof value === 'number') return excelSerialDateToIso(value)
  const numeric = Number(normalized)
  if (Number.isFinite(numeric) && numeric > 20000) return excelSerialDateToIso(numeric)
  return normalizeDateLikeForStorage(normalized)
}

export function parseCell(field: WeldField, value: unknown) {
  if (field.kind === 'boolean') return parseBoolean(value)
  if (field.kind === 'number') return parseNumber(value)
  if (field.kind === 'date') return parseDate(value)
  if (field.key === 'status') return parseJointStatus(value)
  if (field.key === 'finalStatus') return parseFinalStatus(value)
  if (field.key === 'pstoResult') return parsePstoResultStatus(value)
  if (RESULT_FIELD_KEYS.has(field.key as never)) return parseResultStatus(value)
  return emptyToNull(value)
}

function parsePstoResultStatus(value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return null
  if (String(normalized).trim().toLowerCase() === 'проведено') return 'проведено'
  return normalizeResultStatus(normalized)
}

function parseResultStatus(value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return null
  if (String(normalized).trim().toLowerCase() === 'проведено') return null
  return normalizeResultStatus(normalized)
}

function parseFinalStatus(value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return null
  return normalizeFinalStatus(normalized)
}

function parseJointStatus(value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return null
  return String(normalized).trim().toLowerCase() === 'неофициальный' ? 'неофициальный' : null
}
