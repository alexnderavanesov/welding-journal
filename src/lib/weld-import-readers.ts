import { type ImportResult, parseWorksheetRows } from './weld-import-rows'
import { readFirstSheetRows } from './weld-import-sheet-reader'

export async function parseWorkbook(buffer: ArrayBuffer, requiredHeaders?: readonly string[]): Promise<ImportResult> {
  const rows = await readFirstSheetRows(buffer, 'array')
  return parseWorksheetRows(rows, requiredHeaders)
}

export async function parseCsv(text: string, requiredHeaders?: readonly string[]): Promise<ImportResult> {
  const rows = await readFirstSheetRows(text, 'string')
  return parseWorksheetRows(rows, requiredHeaders)
}
