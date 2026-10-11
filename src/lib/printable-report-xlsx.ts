import type { PrintableReport, PrintableReportTable } from './printable-report'
import { escapeXml, normalizeSheetName } from './weld-export-utils'
import { createZip } from './weld-export-zip'

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PALETTES = ['F8FAFC', 'F1F9FD', 'F1FBF7', 'FFFAF0', 'FFF6F7']
const TONES = ['slate', 'blue', 'green', 'amber', 'rose']
const xml = (value: unknown) => escapeXml(String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''))

function column(index: number): string {
  let result = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result
  return result
}

/** Only explicitly numeric columns are parsed. Codes such as 0012 remain text. */
function numericValue(value: string | number, numeric: boolean) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('В отчёте обнаружено некорректное число.')
    return { value, format: '#,##0.##########' }
  }
  if (!numeric) return { value, format: '' }
  const match = value.trim().match(/^(-?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[,.]\d+)?)(?:\s*(%|WDI|стыков))?$/)
  if (!match) return { value, format: '' }
  const normalized = match[1].replace(/[ \u00a0\u202f]/g, '').replace(',', '.')
  const decimals = normalized.split('.')[1]?.length ?? 0
  const unit = match[2]
  return {
    value: Number(normalized) / (unit === '%' ? 100 : 1),
    format: `${unit === '%' ? '0' : '#,##0'}${decimals ? `.${'0'.repeat(decimals)}` : ''}${unit === '%' ? '%' : unit ? ` "${unit}"` : ''}`,
  }
}

type CellStyle = { font?: number; fill?: number; border?: number; align?: string; indent?: number }
class Styles {
  formats: string[] = []
  styles: string[] = []
  ids = new Map<string, number>()
  constructor() { this.id({}) }
  id({ font = 0, fill = 0, border = 0, align = 'left', indent = 1 }: CellStyle, format = '') {
    let numberFormat = 0
    if (format) {
      if (!this.formats.includes(format)) this.formats.push(format)
      numberFormat = 164 + this.formats.indexOf(format)
    }
    const value = `<xf numFmtId="${numberFormat}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="${align}" vertical="center" wrapText="1" indent="${indent}"/></xf>`
    if (!this.ids.has(value)) { this.ids.set(value, this.styles.length); this.styles.push(value) }
    return this.ids.get(value)!
  }
  render() {
    const fonts = [[11, '405168', false], [22, '142033', true], [10, '64748B', false], [11, '334155', true], [21, '243247', true]] as const
    const fills = ['EDF3F7', 'E8EEF4', 'EEF7FB', ...PALETTES]
    return `${XML}<styleSheet xmlns="${NS}"><numFmts count="${this.formats.length}">${this.formats.map((format, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(format)}"/>`).join('')}</numFmts>
      <fonts count="${fonts.length}">${fonts.map(([size, color, bold]) => `<font>${bold ? '<b/>' : ''}<sz val="${size}"/><color rgb="FF${color}"/><name val="Calibri"/><family val="2"/></font>`).join('')}</fonts>
      <fills count="${fills.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills.map(color => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>
      <borders count="2"><border/><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9E2EA"/></bottom></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="${this.styles.length}">${this.styles.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  }
}

class Sheet {
  rows: string[] = []
  merges: string[] = []
  headerRow = 0
  constructor(readonly name: string, readonly widths: number[], readonly styles: Styles) {}
  cell(value: string | number, col: number, style: CellStyle = {}, numeric = false) {
    if (String(value).length > 32767) throw new Error('Текст ячейки превышает допустимый размер Excel. Уточните отбор отчёта.')
    const converted = numericValue(value, numeric)
    const ref = `${column(col)}${this.rows.length + 1}`
    const id = this.styles.id({ ...style, align: style.align ?? (typeof converted.value === 'number' ? 'right' : 'left') }, converted.format)
    return typeof converted.value === 'number'
      ? `<c r="${ref}" s="${id}"><v>${converted.value}</v></c>`
      : `<c r="${ref}" s="${id}" t="inlineStr"><is><t xml:space="preserve">${xml(converted.value)}</t></is></c>`
  }
  row(cells: string[], height = 24) {
    this.rows.push(`<row r="${this.rows.length + 1}" ht="${height}" customHeight="1">${cells.join('')}</row>`)
  }
  merged(value: string, font = 0, height?: number) {
    this.merge(0, this.widths.length - 1)
    this.row([this.cell(value, 0, { font })], height ?? textHeight(value, this.widths.reduce((a, b) => a + b, 0), 24))
  }
  merge(start: number, end: number) {
    if (start !== end) this.merges.push(`${column(start)}${this.rows.length + 1}:${column(end)}${this.rows.length + 1}`)
  }
  render(summary: boolean) {
    if (this.rows.length > 1_048_576 || this.widths.length > 16_384) throw new Error('Отчёт превышает размер листа Excel. Уточните отбор.')
    return `${XML}<worksheet xmlns="${NS}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${column(this.widths.length - 1)}${this.rows.length}"/>
      <sheetViews><sheetView workbookViewId="0" showGridLines="0">${this.headerRow ? `<pane ySplit="${this.headerRow}" topLeftCell="A${this.headerRow + 1}" activePane="bottomLeft" state="frozen"/>` : ''}</sheetView></sheetViews>
      <sheetFormatPr defaultRowHeight="24"/><cols>${this.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
      <sheetData>${this.rows.join('')}</sheetData>${this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}
      <printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.15" footer="0.2"/>
      <pageSetup paperSize="${!summary && this.widths.length > 8 ? 8 : 9}" orientation="${summary || this.widths.length > 5 ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="${summary ? 1 : 0}"/>
      <headerFooter><oddFooter>&amp;R&amp;P / &amp;N</oddFooter></headerFooter></worksheet>`
  }
}

function textHeight(value: string | number, width: number, minimum = 24) {
  const lines = String(value).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(1, width - 3))), 0)
  return Math.min(409, Math.max(minimum, lines * 16 + 10))
}

function uniqueName(title: string, used: Set<string>) {
  const base = normalizeSheetName(title.replace(/^'+|'+$/g, '')).replace(/^'+|'+$/g, '') || 'Отчёт'
  let name = base, suffix = 1
  while (used.has(name.toLocaleLowerCase('ru'))) {
    const ending = ` (${++suffix})`
    name = base.slice(0, 31 - ending.length) + ending
  }
  used.add(name.toLocaleLowerCase('ru'))
  return name
}

/** Styled summaries reuse the report snapshot and the existing ZIP writer, never a server query. */
export function buildPrintableReportXlsx(report: PrintableReport) {
  const styles = new Styles(), names = new Set<string>()
  const summary = new Sheet(uniqueName('Сводка', names), [13, 13, 13, 3, 13, 13, 13, 3, 13, 13, 13], styles)
  summary.merged(report.title, 1, textHeight(report.title, 70, 40))
  if (report.subtitle) summary.merged(report.subtitle, 2)
  for (const item of report.meta ?? []) summary.merged(`${item.label}: ${item.value}`, 2)
  summary.row([], 12)
  const metrics = report.metrics ?? []
  for (let start = 0; start < metrics.length; start += 3) {
    const group = metrics.slice(start, start + 3)
    for (const kind of ['label', 'value', 'detail'] as const) {
      const cells = group.flatMap((metric, i) => {
        const col = i * 4, fill = 5 + Math.max(0, TONES.indexOf(metric.tone ?? 'slate'))
        summary.merge(col, col + 2)
        const style = { fill, font: kind === 'value' ? 4 : kind === 'label' ? 3 : 2, align: 'left', border: kind === 'detail' ? 1 : 0 }
        return [summary.cell(metric[kind] ?? '', col, style, kind === 'value'), summary.cell('', col + 1, style), summary.cell('', col + 2, style)]
      })
      summary.row(cells, kind === 'value' ? 36 : Math.max(...group.map(metric => textHeight(metric[kind] ?? '', 39, kind === 'label' ? 34 : 28))))
    }
    summary.row([], 12)
  }
  const tables: PrintableReportTable[] = [
    ...(report.charts ?? []).map(chart => ({ title: chart.title, subtitle: chart.subtitle, columns: ['Показатель', chart.valueLabel, 'Пояснение'], rows: chart.items.map(item => [item.label, item.value, item.detail ?? '']) })),
    ...(report.tables ?? []),
  ]
  summary.merged(tables.length ? 'Таблицы и данные графиков — на следующих листах книги.' : report.emptyMessage || 'Нет табличных данных.', 2)
  const sheets = [summary]
  for (const table of tables) {
    const numericColumns = new Set(table.numericColumns ?? [])
    const widths = table.columns.map((label, col) => {
      const sample = table.rows.slice(0, 100).map(row => String(row[col] ?? '').length)
      return Math.min(48, Math.max(numericColumns.has(col) ? 14 : 22, Math.min(label.length + 2, 28), ...sample.map(n => Math.min(n + 2, 40))))
    })
    // Small tables still need a readable title/metadata block on a printed A4 sheet.
    const totalWidth = widths.reduce((sum, width) => sum + width, 0)
    if (totalWidth > 0 && totalWidth < 85) widths.forEach((width, index) => { widths[index] = width * 85 / totalWidth })
    const sheet = new Sheet(uniqueName(table.title || 'Таблица', names), widths.length ? widths : [40], styles)
    sheet.merged(table.title || report.title, 1, textHeight(table.title || report.title, widths.reduce((a, b) => a + b, 0) / 2, 40))
    sheet.merged(report.title, 2)
    if (table.subtitle) sheet.merged(table.subtitle, 2)
    for (const meta of report.meta ?? []) sheet.merged(`${meta.label}: ${meta.value}`, 2)
    sheet.row([], 10)
    sheet.row(table.columns.map((label, col) => sheet.cell(label, col, { font: 3, fill: 2, border: 1 })), Math.max(36, ...table.columns.map((label, col) => textHeight(label, widths[col], 36))))
    sheet.headerRow = sheet.rows.length
    table.rows.forEach((row, index) => {
      const kind = table.rowKinds?.[index]
      sheet.row(row.map((value, col) => sheet.cell(value, col, {
        fill: kind === 'total' ? 3 : kind === 'group' ? 4 : 0,
        font: kind === 'total' || kind === 'group' ? 3 : 0,
        border: 1, indent: kind === 'detail' && col === 0 ? 2 : 1,
      }, numericColumns.has(col))), Math.max(24, ...row.map((value, col) => textHeight(value, widths[col] ?? 22))))
    })
    sheets.push(sheet)
  }
  const sheetXml = sheets.map((sheet, index) => sheet.render(index === 0))
  return createZip([
    { path: '[Content_Types].xml', content: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { path: '_rels/.rels', content: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { path: 'xl/workbook.xml', content: `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${sheets.map((sheet, i) => {
      const name = xml(`'${sheet.name.replace(/'/g, "''")}'!`)
      return `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${name}$A$1:$${column(sheet.widths.length - 1)}$${sheet.rows.length}</definedName>${sheet.headerRow ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${name}$${sheet.headerRow}:$${sheet.headerRow}</definedName>` : ''}`
    }).join('')}</definedNames></workbook>` },
    { path: 'xl/_rels/workbook.xml.rels', content: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { path: 'xl/styles.xml', content: styles.render() },
    ...sheetXml.map((content, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, content })),
  ])
}
