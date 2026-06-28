import * as XLSX from 'xlsx'
import { VISIBLE_FIELDS, type WeldField, type WeldInput } from './weld-fields'
import { getExportColumnWidth, normalizeSheetName, recordsToVisibleExportMatrix } from './weld-export-utils'
import type { ExportWorkbookOptions } from './weld-export-types'

export { buildExportSpreadsheetXml } from './weld-export-spreadsheetml'
export { buildExportXlsxBytes } from './weld-export-xlsx-xml'
export { recordsToVisibleExportMatrix } from './weld-export-utils'
export type { ExportWorkbookOptions } from './weld-export-types'

export function buildExportWorkbook(records: WeldInput[], options: ExportWorkbookOptions = {}) {
  const fields = options.fields ?? VISIBLE_FIELDS
  const readOnlyFieldKeys = options.readOnlyFieldKeys ?? new Set()
  const worksheet = XLSX.utils.aoa_to_sheet(recordsToVisibleExportMatrix(records, fields))
  applyExportWorksheetStyles(worksheet, fields, readOnlyFieldKeys)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, normalizeSheetName(options.sheetName ?? 'ЕСО'))
  return workbook
}

function applyExportWorksheetStyles(
  worksheet: XLSX.WorkSheet,
  fields: readonly WeldField[],
  readOnlyFieldKeys: ReadonlySet<string>,
) {
  worksheet['!cols'] = fields.map((field) => ({ wch: getExportColumnWidth(field) }))
  const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null
  if (!range) return

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const field = fields[column]
    const isReadOnly = Boolean(field && readOnlyFieldKeys.has(field.key))
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      const cell = worksheet[address]
      if (!cell) continue
      cell.s = {
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        fill: isReadOnly ? { patternType: 'solid', fgColor: { rgb: 'D1D5DB' } } : undefined,
        font: row === 0 ? { bold: true } : undefined,
      }
    }
  }
}
