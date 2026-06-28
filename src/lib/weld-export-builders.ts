import * as XLSX from 'xlsx'
import { VISIBLE_FIELDS, type WeldField, type WeldInput } from './weld-fields'
import { parseDate, parseNumber } from './weld-import-parsers'

export type ExportWorkbookOptions = {
  fields?: readonly WeldField[]
  readOnlyFieldKeys?: ReadonlySet<string>
  sheetName?: string
}

export function buildExportWorkbook(records: WeldInput[], options: ExportWorkbookOptions = {}) {
  const fields = options.fields ?? VISIBLE_FIELDS
  const readOnlyFieldKeys = options.readOnlyFieldKeys ?? new Set()
  const worksheet = XLSX.utils.aoa_to_sheet(recordsToVisibleExportMatrix(records, fields))
  applyExportWorksheetStyles(worksheet, fields, readOnlyFieldKeys)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, normalizeSheetName(options.sheetName ?? 'ЕСО'))
  return workbook
}

export function buildExportSpreadsheetXml(records: WeldInput[], options: ExportWorkbookOptions = {}) {
  const fields = options.fields ?? VISIBLE_FIELDS
  const readOnlyFieldKeys = options.readOnlyFieldKeys ?? new Set()
  const sheetName = normalizeSheetName(options.sheetName ?? 'ЕСО')
  const rows = recordsToVisibleExportMatrix(records, fields)
  const columnXml = fields
    .map((field) => `<Column ss:Width="${Math.max(getExportColumnWidth(field) * 7, 70)}"/>`)
    .join('')
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const field = fields[columnIndex]
          const styleId =
            rowIndex === 0 ? 'Header' : field && readOnlyFieldKeys.has(field.key) ? 'ReadOnly' : 'Default'
          return `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`
        })
        .join('')
      return `<Row>${cells}</Row>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Font ss:Bold="1"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="ReadOnly">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Interior ss:Color="#D1D5DB" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escapeXml(sheetName)}">
  <Table>${columnXml}${rowXml}</Table>
 </Worksheet>
</Workbook>`
}

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

export function recordsToVisibleExportMatrix(records: WeldInput[], fields: readonly WeldField[] = VISIBLE_FIELDS) {
  return [
    fields.map((field) => field.label),
    ...records.map((record) =>
      fields.map((field) => {
        const value = record[field.key as keyof WeldInput]
        if (field.kind === 'boolean') return value === true ? 'да' : ''
        if (field.kind === 'date') return formatExportDate(value)
        if (field.key === 'wdi') return formatExportNumber(value)
        return value ?? ''
      }),
    ),
  ]
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

function getExportColumnWidth(field: WeldField) {
  if (field.kind === 'date') return 12
  if (field.label.length <= 4) return 10
  return Math.min(Math.max(field.label.length + 4, 14), 28)
}

function normalizeSheetName(value: string) {
  const sheetName = value.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  return (sheetName || 'Отчет').slice(0, 31)
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
}

function buildWorkbookXml(sheetName: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <sheets>
  <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
 </sheets>
</workbook>`
}

function buildWorkbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
}

function buildXlsxStylesXml() {
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

function buildWorksheetXml(rows: unknown[][], fields: readonly WeldField[], readOnlyFieldKeys: ReadonlySet<string>) {
  const cols = fields
    .map((field, index) => {
      const column = index + 1
      return `<col min="${column}" max="${column}" width="${getExportColumnWidth(field)}" customWidth="1"/>`
    })
    .join('')
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const field = fields[columnIndex]
          const styleId = rowIndex === 0 ? 1 : field && readOnlyFieldKeys.has(field.key) ? 2 : 0
          const ref = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })
          if (rowIndex > 0 && field?.key === 'wdi') {
            const number = formatExportNumber(value)
            return number === ''
              ? `<c r="${ref}" s="${styleId}"/>`
              : `<c r="${ref}" s="${styleId}"><v>${number}</v></c>`
          }
          return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t>${escapeXml(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <cols>${cols}</cols>
 <sheetData>${rowXml}</sheetData>
</worksheet>`
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function createZip(files: Array<{ path: string; content: string }>) {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.path)
    const content = encoder.encode(file.content)
    const crc = crc32(content)
    const localHeader = new Uint8Array(30 + name.length)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, 0, true)
    localView.setUint16(12, 0, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, content.length, true)
    localView.setUint32(22, content.length, true)
    localView.setUint16(26, name.length, true)
    localHeader.set(name, 30)
    localParts.push(localHeader, content)

    const centralHeader = new Uint8Array(46 + name.length)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint16(14, 0, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, content.length, true)
    centralView.setUint32(24, content.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    centralHeader.set(name, 46)
    centralParts.push(centralHeader)

    offset += localHeader.length + content.length
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, centralOffset, true)

  return concatBytes([...localParts, ...centralParts, end])
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

const crcTable = new Uint32Array(
  Array.from({ length: 256 }, (_, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    return value >>> 0
  }),
)

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function formatExportDate(value: unknown) {
  const normalized = parseDate(value)
  if (!normalized) return ''
  const isoMatch = String(normalized).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!isoMatch) return normalized
  return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`
}

function formatExportNumber(value: unknown) {
  const number = parseNumber(value)
  return number === null ? '' : number
}
