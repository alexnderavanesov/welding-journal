import * as XLSX from 'xlsx'
import {
  FIELD_BY_KEY,
  EXCEL_FIELDS,
  FULL_EXCEL_HEADERS,
  type WeldFieldKey,
  type WeldInput,
  calculateFinalStatus,
  normalizeHeader,
} from './weld-fields'
import { emptyToNull, parseCell } from './weld-import-parsers'
export {
  emptyToNull,
  excelSerialDateToIso,
  parseBoolean,
  parseCell,
  parseDate,
  parseNumber,
} from './weld-import-parsers'
export {
  buildExportSpreadsheetXml,
  buildExportWorkbook,
  buildExportXlsxBytes,
  recordsToVisibleExportMatrix,
} from './weld-export-builders'
export type { ExportWorkbookOptions } from './weld-export-builders'

export type ImportResult = {
  records: WeldInput[]
  skippedRows: number
  headers: string[]
  missingHeaders: string[]
}

export type EditableImportOptions = {
  editableFieldKeys: ReadonlySet<string>
  matchFieldKeys: ReadonlySet<string>
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
    'Заявка ВИК',
    'Заявка РК',
    'Заявка ПВК',
    'Заявка УЗК',
    'Заявка ПСТО',
    'Заявка ТВМТ',
    'Заявка РФА',
    'Заявка СТЛС',
    'Заявка МКК',
    'дата ПСТО',
    'диаграмма термообработки',
    'примечание',
    'BoQ ПСТО',
    'КС3 ПСТО',
    'BoQ ВИК',
    'КС3 ВИК',
    'BoQ РК',
    'КС3 РК',
    'BoQ ПВК',
    'КС3 ПВК',
    'BoQ УЗК',
    'КС3 УЗК',
    'BoQ ТВМТ',
    'КС3 ТВМТ',
    'BoQ РФА',
    'КС3 РФА',
    'BoQ СТЛС',
    'КС3 СТЛС',
    'BoQ МКК',
    'КС3 МКК',
    'Дата ВИК',
    'Заключение ВИК',
    'Дата РК',
    'Заключение РК',
    'Дата ПВК',
    'Заключение ПВК',
    'Дата УЗК',
    'Заключение УЗК',
    'Дата ТВМТ',
    'Заключение ТВМТ',
    'Дата РФА',
    'Заключение РФА',
    'Дата СТЛС',
    'Заключение СТЛС',
    'Дата МКК',
    'Заключение МКК',
    'Описание дефектов',
    'Примечание',
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
    record.status = null
    record.finalStatus = calculateFinalStatus(record)
    records.push(record)
  }

  return { records, skippedRows, headers, missingHeaders }
}

export function parseEditableWorksheetRows(rows: unknown[][], options: EditableImportOptions): ImportResult {
  const [rawHeaders = [], ...dataRows] = rows
  const headers = normalizeImportHeaders(rawHeaders)
  const fieldsByColumn = mapHeadersToFields(headers)
  const records: WeldInput[] = []
  let skippedRows = 0

  for (const row of dataRows) {
    const record: WeldInput = {}
    let hasEditableColumn = false

    fieldsByColumn.forEach((field, index) => {
      if (!field) return
      if (!options.editableFieldKeys.has(field.key) && !options.matchFieldKeys.has(field.key)) return

      record[field.key] = parseCell(field, row[index])
      if (options.editableFieldKeys.has(field.key)) {
        hasEditableColumn = true
      }
    })

    if (!hasEditableColumn || !hasImportMatchFields(record, options.matchFieldKeys)) {
      skippedRows += 1
      continue
    }

    records.push(record)
  }

  return { records, skippedRows, headers, missingHeaders: [] }
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

export function parseEditableWorkbook(buffer: ArrayBuffer, options: EditableImportOptions): ImportResult {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: true, defval: null })
  return parseEditableWorksheetRows(rows, options)
}

export function parseCsv(text: string): ImportResult {
  const workbook = XLSX.read(text, { type: 'string', raw: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: true, defval: null })
  return parseWorksheetRows(rows)
}

export function parseEditableCsv(text: string, options: EditableImportOptions): ImportResult {
  const workbook = XLSX.read(text, { type: 'string', raw: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: true, defval: null })
  return parseEditableWorksheetRows(rows, options)
}

export function isMeaningfulRecord(record: WeldInput) {
  return Boolean(record.joint || record.line || record.isometry)
}

function hasImportMatchFields(record: WeldInput, matchFieldKeys: ReadonlySet<string>) {
  return [...matchFieldKeys].every((fieldKey) => emptyToNull(record[fieldKey as keyof WeldInput]) !== null)
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

export function appendImportedWelds<T extends WeldInput & { id: number }>(existingRows: T[], importedRecords: WeldInput[]) {
  let nextId = existingRows.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const importedRows = importedRecords.map((record) => ({ id: nextId++, ...normalizeWeldInput(record) }))
  return [...importedRows, ...existingRows]
}

export function withAutoVikForWeldDate<T extends WeldInput>(record: T): T {
  if (String(record.hasVik ?? '').trim().toLowerCase() === 'отменен') return record
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
