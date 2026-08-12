import {
  FULL_EXCEL_HEADERS,
  type WeldInput,
  calculateFinalStatus,
} from './weld-fields'
import { mapHeadersToFields, normalizeImportHeaders } from './weld-import-headers'
import { parseImportCell } from './weld-import-parsers'

export type ImportResult = {
  records: WeldInput[]
  skippedRows: number
  headers: string[]
  missingHeaders: string[]
}

export function parseWorksheetRows(
  rows: unknown[][],
  requiredHeaders: readonly string[] = FULL_EXCEL_HEADERS,
): ImportResult {
  const [rawHeaders = [], ...dataRows] = rows
  const headers = normalizeImportHeaders(rawHeaders)
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header))

  if (missingHeaders.length > 0) {
    throw new Error(`Не найдены обязательные колонки: ${missingHeaders.join(', ')}`)
  }

  const fieldsByColumn = mapHeadersToFields(headers)
  const records: WeldInput[] = []
  let skippedRows = 0

  for (const [rowIndex, row] of dataRows.entries()) {
    const record: WeldInput = {}
    try {
      fieldsByColumn.forEach((field, index) => {
        if (!field) return
        ;(record as Record<string, unknown>)[field.key] = parseImportCell(field, row[index])
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'значение не распознано'
      throw new Error(`Строка ${rowIndex + 2}: ${message}`)
    }

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

export function isMeaningfulRecord(record: WeldInput) {
  return Boolean(record.joint || record.line || record.isometry)
}
