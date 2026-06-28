import { VISIBLE_FIELDS, type WeldInput } from './weld-fields'
import {
  escapeXml,
  getExportColumnWidth,
  normalizeSheetName,
  recordsToVisibleExportMatrix,
} from './weld-export-utils'
import type { ExportWorkbookOptions } from './weld-export-types'

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
