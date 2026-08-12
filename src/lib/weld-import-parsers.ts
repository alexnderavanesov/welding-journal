import {
  RESULT_FIELD_KEYS,
  FINAL_STATUS_OPTIONS,
  RESULT_STATUS_OPTIONS,
  type WeldField,
  normalizeFinalStatus,
  normalizeResultStatus,
} from './weld-fields'
import { normalizeDateLikeForStorage, parseDateLikeToIso } from './date-format'
import { normalizeControlAvailabilityText } from '@/lib/control-availability-values'

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
  const text = normalizeControlAvailabilityText(normalized)
  if (['да', 'yes', 'true', '1', '+'].includes(text)) return true
  if (text === 'отменен') return 'отменен'
  if (text === 'дополнительный') return 'дополнительный'
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
  if (field.key === 'lnkDefectDescription') return multilineTextToNull(value)
  if (field.key === 'status') return parseJointStatus(value)
  if (field.key === 'finalStatus') return parseFinalStatus(value)
  if (field.key === 'pstoResult') return parsePstoResultStatus(value)
  if (RESULT_FIELD_KEYS.has(field.key as never)) return parseResultStatus(value)
  return emptyToNull(value)
}

export function parseImportCell(field: WeldField, value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return null

  if (field.kind === 'boolean') {
    const parsed = parseBoolean(value)
    const text = normalizeControlAvailabilityText(normalized)
    const allowed = new Set([
      'да', 'yes', 'true', '1', '+',
      'нет', 'no', 'false', '0', '-',
      'отменен', 'дополнительный', 'замена рк/узк',
    ])
    if (!allowed.has(text)) throw invalidImportValue(field, value)
    return parsed
  }

  if (field.kind === 'number') {
    const parsed = parseNumber(value)
    if (parsed === null) throw invalidImportValue(field, value)
    return parsed
  }

  if (field.kind === 'date') {
    if (typeof value === 'number') return excelSerialDateToIso(value)
    const numeric = Number(normalized)
    if (Number.isFinite(numeric) && numeric > 20_000) return excelSerialDateToIso(numeric)
    const parsed = parseDateLikeToIso(normalized)
    if (!parsed) throw invalidImportValue(field, value, 'используйте формат ДД.ММ.ГГГГ')
    return parsed
  }

  const parsed = parseCell(field, value)
  if (!isRecognizedImportedStatus(field, normalized)) throw invalidImportValue(field, value)
  return parsed
}

function isRecognizedImportedStatus(field: WeldField, value: unknown) {
  const text = String(value).trim().toLowerCase()
  if (field.key === 'status') return ['официальный', 'неофициальный'].includes(text)
  if (field.key === 'finalStatus') {
    return ['ожидает', 'не годен по дублю', ...FINAL_STATUS_OPTIONS.map((option) => option.toLowerCase())].includes(text)
  }
  if (field.key === 'pstoResult') {
    return ['проведено', 'да', ...RESULT_STATUS_OPTIONS.map((option) => option.toLowerCase())].includes(text)
  }
  if (RESULT_FIELD_KEYS.has(field.key as never)) {
    return ['проведено', 'да', 'годен (отменен)', ...RESULT_STATUS_OPTIONS.map((option) => option.toLowerCase())].includes(text)
  }
  return true
}

function invalidImportValue(field: WeldField, value: unknown, hint = 'укажите допустимое значение') {
  return new Error(`Поле "${field.label}": значение "${String(value).trim()}" не распознано; ${hint}.`)
}

function multilineTextToNull(value: unknown) {
  if (value === null || value === undefined) return null
  const normalized = String(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim()
  return normalized === '' || normalized === '-' ? null : normalized
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
