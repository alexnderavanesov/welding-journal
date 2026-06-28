import {
  FULL_EXCEL_HEADERS,
  type WeldInput,
  calculateFinalStatus,
} from './weld-fields'
import { mapHeadersToFields, normalizeImportHeaders, OPTIONAL_LEGACY_IMPORT_HEADERS } from './weld-import-headers'
import { emptyToNull, parseCell } from './weld-import-parsers'

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
  const acceptsLegacy = missingHeaders.length === 0 || missingHeaders.every((header) => OPTIONAL_LEGACY_IMPORT_HEADERS.has(header))

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

export function isMeaningfulRecord(record: WeldInput) {
  return Boolean(record.joint || record.line || record.isometry)
}

function hasImportMatchFields(record: WeldInput, matchFieldKeys: ReadonlySet<string>) {
  return [...matchFieldKeys].every((fieldKey) => emptyToNull(record[fieldKey as keyof WeldInput]) !== null)
}
