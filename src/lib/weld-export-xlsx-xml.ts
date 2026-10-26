import { VISIBLE_FIELDS, type WeldField, type WeldInput } from './weld-fields'
import {
  escapeXml,
  formatExportNumber,
  getExportColumnWidth,
  normalizeSheetName,
  recordsToVisibleExportMatrix,
} from './weld-export-utils'
import type { ExportWorkbookOptions } from './weld-export-types'
import { createZip } from './weld-export-zip'

export const EXCEL_SHEET_DATA_ROWS = 1_048_575

export function buildExportXlsxBytes(records: WeldInput[], options: ExportWorkbookOptions = {}) {
  const fields = options.fields ?? VISIBLE_FIELDS
  const readOnlyFieldKeys = options.readOnlyFieldKeys ?? new Set()
  const sheetName = normalizeSheetName(options.sheetName ?? 'ЕСО')
  const rows = recordsToVisibleExportMatrix(records, fields)

  return createZip([
    { path: '[Content_Types].xml', content: buildContentTypesXml() },
    { path: '_rels/.rels', content: buildRootRelsXml() },
    { path: 'xl/workbook.xml', content: buildWorkbookXml(sheetName) },
    { path: 'xl/_rels/workbook.xml.rels', content: buildWorkbookRelsXml() },
    { path: 'xl/styles.xml', content: buildXlsxStylesXml() },
    { path: 'xl/worksheets/sheet1.xml', content: buildWorksheetXml(rows, fields, readOnlyFieldKeys) },
  ])
}

export function buildContentTypesXml(sheetCount = 1) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 ${Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
 <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
}

export function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
}

export function buildWorkbookXml(sheetName: string | string[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <sheets>
  ${(Array.isArray(sheetName) ? sheetName : [sheetName]).map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('\n')}
 </sheets>
</workbook>`
}

export function buildWorkbookRelsXml(sheetCount = 1) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 ${Array.from({ length: sheetCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('\n')}
 <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
}

export function buildXlsxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <fonts count="2">
  <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
 </fonts>
 <fills count="4">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFD1D5DB"/></patternFill></fill>
 </fills>
 <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
 <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
 <cellXfs count="3">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
 </cellXfs>
 <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
 <dxfs count="0"/>
 <tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>
</styleSheet>`
}

export function buildWorksheetHeader(fields: readonly WeldField[]) {
  const cols = fields.map((field, index) => `<col min="${index + 1}" max="${index + 1}" width="${getExportColumnWidth(field)}" customWidth="1"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <cols>${cols}</cols>
 <sheetData>`
}

export function buildWorksheetRow(row: unknown[], fields: readonly WeldField[], rowIndex: number, readOnlyFieldKeys: ReadonlySet<string> = new Set()) {
  const cells = row.map((value, columnIndex) => {
    const field = fields[columnIndex]
    const styleId = rowIndex === 0 ? 1 : field && readOnlyFieldKeys.has(field.key) ? 2 : 0
    const ref = encodeCellRef(rowIndex, columnIndex)
    if (rowIndex > 0 && field?.key === 'wdi') {
      const number = formatExportNumber(value)
      return number === '' ? `<c r="${ref}" s="${styleId}"/>` : `<c r="${ref}" s="${styleId}"><v>${number}</v></c>`
    }
    return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t>${escapeXml(value)}</t></is></c>`
  }).join('')
  return `<row r="${rowIndex + 1}">${cells}</row>`
}
export const WORKSHEET_END = '</sheetData>\n</worksheet>'

function buildWorksheetXml(rows: unknown[][], fields: readonly WeldField[], readOnlyFieldKeys: ReadonlySet<string>) {
  return buildWorksheetHeader(fields) + rows.map((row, index) => buildWorksheetRow(row, fields, index, readOnlyFieldKeys)).join('') + WORKSHEET_END
}

function encodeCellRef(rowIndex: number, columnIndex: number) {
  let columnNumber = columnIndex + 1
  let columnName = ''
  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26
    columnName = String.fromCharCode(65 + remainder) + columnName
    columnNumber = Math.floor((columnNumber - 1) / 26)
  }
  return `${columnName}${rowIndex + 1}`
}
