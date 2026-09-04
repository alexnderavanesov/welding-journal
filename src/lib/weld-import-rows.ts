import {
  REQUIRED_EXCEL_HEADERS,
  type WeldInput,
  calculateFinalStatus,
} from './weld-fields'
import { mapHeadersToFields, normalizeImportHeaders } from './weld-import-headers'
import { parseImportCell } from './weld-import-parsers'

export type ImportCellError = {
  recordIndex: number
  rowNumber: number
  message: string
  fieldKeys: string[]
}

export type ImportResult = {
  records: WeldInput[]
  recordRowNumbers: number[]
  cellErrors: ImportCellError[]
  skippedRows: number
  headers: string[]
  missingHeaders: string[]
}

export function parseWorksheetRows(
  rows: unknown[][],
  requiredHeaders: readonly string[] = REQUIRED_EXCEL_HEADERS,
): ImportResult {
  const [rawHeaders = [], ...dataRows] = rows
  const headers = normalizeImportHeaders(rawHeaders)
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header))

  if (missingHeaders.length > 0) {
    throw new Error(`Не найдены обязательные колонки: ${missingHeaders.join(', ')}`)
  }

  const fieldsByColumn = mapHeadersToFields(headers)
  const records: WeldInput[] = []
  const recordRowNumbers: number[] = []
  const cellErrors: ImportCellError[] = []
  let skippedRows = 0

  for (const [rowIndex, row] of dataRows.entries()) {
    const record: WeldInput = {}
    const rowCellErrors: Array<{ message: string; fieldKey: string }> = []
    fieldsByColumn.forEach((field, index) => {
      if (!field) return
      try {
        ;(record as Record<string, unknown>)[field.key] = parseImportCell(field, row[index])
      } catch (error) {
        ;(record as Record<string, unknown>)[field.key] = null
        rowCellErrors.push({
          message: error instanceof Error ? error.message : 'Значение не распознано.',
          fieldKey: field.key,
        })
      }
    })

    if (!isMeaningfulRecord(record) && rowCellErrors.length === 0) {
      skippedRows += 1
      continue
    }

    if (!('spoolId' in record)) {
      record.spoolId = null
    }
    record.officiality = null
    record.finalStatus = calculateFinalStatus(record)
    const recordIndex = records.length
    records.push(record)
    recordRowNumbers.push(rowIndex + 2)
    rowCellErrors.forEach((error) => cellErrors.push({
      recordIndex,
      rowNumber: rowIndex + 2,
      message: error.message,
      fieldKeys: [error.fieldKey],
    }))
  }

  return { records, recordRowNumbers, cellErrors, skippedRows, headers, missingHeaders }
}

export function isMeaningfulRecord(record: WeldInput) {
  return Boolean(record.joint || record.line || record.isometry)
}
