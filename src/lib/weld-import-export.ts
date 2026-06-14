import * as XLSX from 'xlsx'
import {
  FIELD_BY_KEY,
  EXCEL_FIELDS,
  FULL_EXCEL_HEADERS,
  LEGACY_EXCEL_HEADERS,
  RESULT_FIELD_KEYS,
  VISIBLE_FIELDS,
  type WeldField,
  type WeldInput,
  calculateFinalStatus,
  normalizeFinalStatus,
  normalizeHeader,
  normalizeResultStatus,
} from './weld-fields'

export type ImportResult = {
  records: WeldInput[]
  skippedRows: number
  headers: string[]
  missingHeaders: string[]
}

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
  const date = new Date(String(normalized))
  return Number.isNaN(date.getTime()) ? String(normalized) : date.toISOString().slice(0, 10)
}

export function parseCell(field: WeldField, value: unknown) {
  if (field.kind === 'boolean') return parseBoolean(value)
  if (field.kind === 'number') return parseNumber(value)
  if (field.kind === 'date') return parseDate(value)
  if (field.key === 'status') return parseJointStatus(value)
  if (field.key === 'finalStatus') return parseFinalStatus(value)
  if (RESULT_FIELD_KEYS.has(field.key as never)) return parseResultStatus(value)
  return emptyToNull(value)
}

function parseResultStatus(value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return null
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

export function parseWorksheetRows(rows: unknown[][]): ImportResult {
  const [rawHeaders = [], ...dataRows] = rows
  const headers = normalizeImportHeaders(rawHeaders)
  const missingHeaders = FULL_EXCEL_HEADERS.filter((header) => !headers.includes(header))
  const optionalHeaders = new Set([
    'ID cпула',
    'Зона стыка',
    'Ном. стыка',
    'Индкес',
    'R/W стыка',
    'Номер спула',
    'наличие МКК',
    'результат РФА',
  ])
  const acceptsLegacy = missingHeaders.length === 0 || missingHeaders.every((header) => optionalHeaders.has(header))

  if (!acceptsLegacy) {
    throw new Error(`Не найдены обязательные колонки: ${missingHeaders.join(', ')}`)
  }

  const fieldsByColumn = mapHeadersToFields(headers)
  const records: WeldInput[] = []
  let skippedRows = 0

  for (const row of dataRows) {
    const record: WeldInput = {}
    fieldsByColumn.forEach((field, index) => {
      if (!field) return
      record[field.key] = parseCell(field, row[index])
    })

    if (!isMeaningfulRecord(record)) {
      skippedRows += 1
      continue
    }

    if (!('spoolId' in record)) {
      record.spoolId = null
    }
    record.finalStatus = calculateFinalStatus(record)
    records.push(record)
  }

  return { records, skippedRows, headers, missingHeaders }
}

function normalizeImportHeaders(values: unknown[]) {
  let pstoCount = 0
  const rawHeaders = values.map(normalizeHeader)
  const hasExplicitPstoRequired = rawHeaders.includes('наличие ПСТО')
  const resultHeaderMap = new Map([
    ['ВИК', 'результат ВИК'],
    ['РК', 'результат РК'],
    ['ПВК', 'результат ПВК'],
    ['УЗК', 'результат УЗК'],
    ['ТВМТ', 'результат ТВМТ'],
    ['РФА', 'результат РФА'],
    ['СТЛС', 'результат СТЛС'],
    ['МКК', 'результат МКК'],
  ])

  return rawHeaders.map((header) => {
    if (header === 'ПСТО') {
      if (hasExplicitPstoRequired) return 'ПСТО'
      pstoCount += 1
      return pstoCount === 1 ? 'наличие ПСТО' : 'результат ПСТО'
    }
    if (resultHeaderMap.has(header)) return resultHeaderMap.get(header)!
    return header === 'Конт-роль швов, (%)' ? 'Контроль швов, (%)' : header
  })
}

function mapHeadersToFields(headers: string[]) {
  const seen = new Map<string, number>()

  return headers.map((header) => {
    const count = seen.get(header) ?? 0
    seen.set(header, count + 1)
    const candidates = EXCEL_FIELDS.filter((field) => field.label === header)
    return candidates[count] ?? candidates[0] ?? null
  })
}

export function parseWorkbook(buffer: ArrayBuffer): ImportResult {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: true, defval: null })
  return parseWorksheetRows(rows)
}

export function parseCsv(text: string): ImportResult {
  const workbook = XLSX.read(text, { type: 'string', raw: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: true, defval: null })
  return parseWorksheetRows(rows)
}

export function isMeaningfulRecord(record: WeldInput) {
  return Boolean(record.joint || record.line || record.isometry)
}

export function recordsToExportRows(records: WeldInput[]) {
  return records.map((record) => {
    const row: Record<string, string | number | boolean | null> = {}
    for (const field of EXCEL_FIELDS) {
      const value = record[field.key]
      if (field.kind === 'boolean') {
        row[field.label] = value === true ? 'да' : ''
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
        if (field.kind === 'boolean') return value === true ? 'да' : ''
        return value ?? ''
      }),
    ),
  ]
}

export function buildExportWorkbook(records: WeldInput[]) {
  const worksheet = XLSX.utils.aoa_to_sheet(recordsToVisibleExportMatrix(records))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ЕСО')
  return workbook
}

export function recordsToVisibleExportMatrix(records: WeldInput[]) {
  return [
    VISIBLE_FIELDS.map((field) => field.label),
    ...records.map((record) =>
      VISIBLE_FIELDS.map((field) => {
        const value = record[field.key]
        if (field.kind === 'boolean') return value === true ? 'да' : ''
        return value ?? ''
      }),
    ),
  ]
}

export function normalizeWeldInput(input: WeldInput) {
  const normalized: WeldInput = {}
  for (const [key, value] of Object.entries(input)) {
    const field = FIELD_BY_KEY.get(key as keyof WeldInput)
    if (!field) continue
    normalized[field.key as keyof WeldInput] = parseCell(field, value)
  }
  normalized.finalStatus = calculateFinalStatus(normalized)
  return normalized
}

export function appendImportedWelds<T extends WeldInput & { id: number }>(existingRows: T[], importedRecords: WeldInput[]) {
  let nextId = existingRows.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const importedRows = importedRecords.map((record) => ({ id: nextId++, ...normalizeWeldInput(record) }))
  return [...importedRows, ...existingRows]
}
