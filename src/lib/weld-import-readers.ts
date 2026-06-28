import * as XLSX from 'xlsx'
import {
  type EditableImportOptions,
  type ImportResult,
  parseEditableWorksheetRows,
  parseWorksheetRows,
} from './weld-import-rows'

export function parseWorkbook(buffer: ArrayBuffer): ImportResult {
  const rows = readFirstSheetRows(buffer, 'array')
  return parseWorksheetRows(rows)
}

export function parseEditableWorkbook(buffer: ArrayBuffer, options: EditableImportOptions): ImportResult {
  const rows = readFirstSheetRows(buffer, 'array')
  return parseEditableWorksheetRows(rows, options)
}

export function parseCsv(text: string): ImportResult {
  const rows = readFirstSheetRows(text, 'string')
  return parseWorksheetRows(rows)
}

export function parseEditableCsv(text: string, options: EditableImportOptions): ImportResult {
  const rows = readFirstSheetRows(text, 'string')
  return parseEditableWorksheetRows(rows, options)
}

function readFirstSheetRows(data: ArrayBuffer | string, type: 'array' | 'string') {
  const workbook = XLSX.read(data, { type, raw: true, cellDates: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: true, defval: null })
}
