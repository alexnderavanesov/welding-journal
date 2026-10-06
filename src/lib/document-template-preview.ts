import type * as XLSXTypes from 'xlsx'
import { type WeldInput } from '@/lib/weld-fields'

import {
  type StoredDocumentTemplate,
  type DocumentTemplateWorkbookPreview,
  type WeldingJournalTemplateContext,
  type DocumentTemplatePreviewCell,
  type DocumentTemplatePreviewCellStyle,
} from '@/lib/document-template-model'
import { createWeldingJournalBlobFromTemplate, getTemplateCellText } from '@/lib/document-template-workbook'
import {
  loadXlsx,
  isObjectRecord,
  XLSX,
  type CfbContainer,
  readCfbText,
  getWorksheetPath,
  extractXmlCollection,
  extractCellStyleMap,
  parseXmlAttributes,
} from '@/lib/document-template-xlsx'

export async function readDocumentTemplateWorkbookPreview(
  template: StoredDocumentTemplate,
  requestedSheetName?: string,
): Promise<DocumentTemplateWorkbookPreview> {
  if (!['xlsx', 'xls'].includes(template.fileType)) {
    throw new Error('Конструктор ячеек доступен для Excel-шаблонов .xlsx и .xls.')
  }

  return readDocumentWorkbookPreview(template.fileData, requestedSheetName, {
    preferredSheetName: template.constructorConfig?.sheetName,
    maxRows: 80,
    maxColumns: 40,
    minimumRows: 20,
    minimumColumns: 10,
  })
}

export async function createWeldingJournalDocumentPreview(
  template: StoredDocumentTemplate,
  records: WeldInput[],
  context: WeldingJournalTemplateContext = {},
): Promise<DocumentTemplateWorkbookPreview> {
  const blob = await createWeldingJournalBlobFromTemplate(template, records, context)
  return readDocumentWorkbookPreview(await readPreviewBlobAsArrayBuffer(blob), template.constructorConfig?.sheetName, {
    preferredSheetName: template.constructorConfig?.sheetName,
    maxRows: 32,
    maxColumns: 40,
    minimumRows: 1,
    minimumColumns: 1,
  })
}

function readPreviewBlobAsArrayBuffer(blob: Blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
}

type WorkbookPreviewReadOptions = {
  preferredSheetName?: string
  maxRows: number
  maxColumns: number
  minimumRows: number
  minimumColumns: number
}

async function readDocumentWorkbookPreview(
  fileData: ArrayBuffer,
  requestedSheetName: string | undefined,
  options: WorkbookPreviewReadOptions,
): Promise<DocumentTemplateWorkbookPreview> {
  const XLSX = await loadXlsx()
  const workbook = XLSX.read(fileData, { type: 'array', cellStyles: true })
  const sheetName =
    requestedSheetName && workbook.SheetNames.includes(requestedSheetName)
      ? requestedSheetName
      : options.preferredSheetName && workbook.SheetNames.includes(options.preferredSheetName)
        ? options.preferredSheetName
        : workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) throw new Error('В шаблоне не найден выбранный лист.')
  const xmlStylesByCell = getPreviewWorkbookXmlStyles(
    fileData,
    workbook.SheetNames.indexOf(sheetName),
  )

  const sourceRange = worksheet['!ref']
    ? XLSX.utils.decode_range(worksheet['!ref'])
    : {
        s: { r: 0, c: 0 },
        e: {
          r: Math.max(options.minimumRows - 1, 0),
          c: Math.max(options.minimumColumns - 1, 0),
        },
      }
  const minimumEndRow = sourceRange.s.r + Math.max(options.minimumRows - 1, 0)
  const minimumEndColumn = sourceRange.s.c + Math.max(options.minimumColumns - 1, 0)
  const endRow = Math.min(
    Math.max(sourceRange.e.r, minimumEndRow),
    sourceRange.s.r + options.maxRows - 1,
  )
  const endColumn = Math.min(
    Math.max(sourceRange.e.c, minimumEndColumn),
    sourceRange.s.c + options.maxColumns - 1,
  )
  const hiddenCells = new Set<string>()
  const mergeByStart = new Map<string, XLSXTypes.Range>()

  for (const merge of worksheet['!merges'] ?? []) {
    const startAddress = XLSX.utils.encode_cell(merge.s)
    mergeByStart.set(startAddress, merge)
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      for (let column = merge.s.c; column <= merge.e.c; column += 1) {
        if (row === merge.s.r && column === merge.s.c) continue
        hiddenCells.add(XLSX.utils.encode_cell({ r: row, c: column }))
      }
    }
  }

  const cells: DocumentTemplatePreviewCell[] = []
  for (let row = sourceRange.s.r; row <= endRow; row += 1) {
    for (let column = sourceRange.s.c; column <= endColumn; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      if (hiddenCells.has(address)) continue
      const merge = mergeByStart.get(address)
      const cell = worksheet[address]
      cells.push({
        address,
        row: row + 1,
        column: column + 1,
        value: String(getTemplateCellText(cell) ?? ''),
        rowSpan: merge ? Math.min(merge.e.r, endRow) - merge.s.r + 1 : 1,
        columnSpan: merge ? Math.min(merge.e.c, endColumn) - merge.s.c + 1 : 1,
        style: {
          ...getPreviewCellStyle(cell?.s),
          ...xmlStylesByCell.get(`${row + 1}:${column + 1}`),
        },
      })
    }
  }

  return {
    sheetNames: [...workbook.SheetNames],
    sheetName,
    startRow: sourceRange.s.r + 1,
    startColumn: sourceRange.s.c + 1,
    rowCount: endRow - sourceRange.s.r + 1,
    columnCount: endColumn - sourceRange.s.c + 1,
    cells,
    hiddenCells: Array.from(hiddenCells),
    columnWidths: Array.from(
      { length: endColumn - sourceRange.s.c + 1 },
      (_, index) => getPreviewColumnWidth(worksheet['!cols']?.[sourceRange.s.c + index]),
    ),
    rowHeights: Array.from(
      { length: endRow - sourceRange.s.r + 1 },
      (_, index) => getPreviewRowHeight(worksheet['!rows']?.[sourceRange.s.r + index]),
    ),
    truncated: sourceRange.e.r > endRow || sourceRange.e.c > endColumn,
  }
}

function getPreviewColumnWidth(column: XLSXTypes.ColInfo | undefined) {
  const width =
    typeof column?.wpx === 'number'
      ? column.wpx
      : typeof column?.wch === 'number'
        ? column.wch * 7 + 12
        : typeof column?.width === 'number'
          ? column.width * 7
          : 96
  return Math.min(Math.max(Math.round(width), 44), 360)
}

function getPreviewRowHeight(row: XLSXTypes.RowInfo | undefined) {
  const height =
    typeof row?.hpx === 'number'
      ? row.hpx
      : typeof row?.hpt === 'number'
        ? row.hpt * (96 / 72)
        : 28
  return Math.min(Math.max(Math.round(height), 20), 180)
}

function getPreviewCellStyle(style: unknown): DocumentTemplatePreviewCellStyle {
  if (!isObjectRecord(style)) return {}

  const font = isObjectRecord(style.font) ? style.font : {}
  const fill = isObjectRecord(style.fill) ? style.fill : style
  const alignment = isObjectRecord(style.alignment) ? style.alignment : {}
  const border = isObjectRecord(style.border) ? style.border : {}
  const underline = Boolean(font.underline)
  const strike = Boolean(font.strike)
  const textDecoration = [underline ? 'underline' : '', strike ? 'line-through' : ''].filter(Boolean).join(' ')

  return {
    backgroundColor: getPreviewColor(fill.fgColor),
    color: getPreviewColor(font.color),
    fontFamily: typeof font.name === 'string' ? font.name : undefined,
    fontSize: typeof font.sz === 'number' ? font.sz : undefined,
    fontWeight: font.bold ? 700 : undefined,
    fontStyle: font.italic ? 'italic' : undefined,
    textDecoration: textDecoration || undefined,
    textAlign: normalizePreviewHorizontalAlignment(alignment.horizontal),
    verticalAlign: normalizePreviewVerticalAlignment(alignment.vertical),
    whiteSpace: alignment.wrapText ? 'pre-line' : 'normal',
    borderTop: getPreviewBorder(border.top),
    borderRight: getPreviewBorder(border.right),
    borderBottom: getPreviewBorder(border.bottom),
    borderLeft: getPreviewBorder(border.left),
  }
}

function getPreviewWorkbookXmlStyles(fileData: ArrayBuffer, sheetIndex: number) {
  try {
    const cfb = XLSX.CFB.read(new Uint8Array(fileData), { type: 'array' }) as CfbContainer
    const stylesXml = readCfbText(cfb, 'xl/styles.xml')
    const sheetXml = readCfbText(cfb, getWorksheetPath(cfb, sheetIndex))
    if (!stylesXml || !sheetXml) return new Map<string, DocumentTemplatePreviewCellStyle>()

    const fonts = extractXmlCollection(stylesXml, 'fonts', 'font').map(parsePreviewFont)
    const fills = extractXmlCollection(stylesXml, 'fills', 'fill').map(parsePreviewFill)
    const borders = extractXmlCollection(stylesXml, 'borders', 'border').map(parsePreviewBorder)
    const cellFormats = extractXmlCollection(stylesXml, 'cellXfs', 'xf').map((xf) =>
      parsePreviewCellFormat(xf, fonts, fills, borders),
    )
    const styleIds = extractCellStyleMap(sheetXml)
    return new Map(
      Array.from(styleIds.entries()).map(([cell, styleId]) => [
        cell,
        cellFormats[Number(styleId)] ?? {},
      ]),
    )
  } catch {
    return new Map<string, DocumentTemplatePreviewCellStyle>()
  }
}

function parsePreviewFont(xml: string): DocumentTemplatePreviewCellStyle {
  const fontName = getXmlElementAttribute(xml, 'name', 'val')
  const fontSize = Number(getXmlElementAttribute(xml, 'sz', 'val'))
  const underline = /<u\b/.test(xml)
  const strike = /<strike\b/.test(xml)
  return compactPreviewCellStyle({
    color: getPreviewXmlColor(xml.match(/<color\b[^>]*\/?>/)?.[0]),
    fontFamily: fontName || undefined,
    fontSize: Number.isFinite(fontSize) ? fontSize : undefined,
    fontWeight: /<b\b/.test(xml) ? 700 : undefined,
    fontStyle: /<i\b/.test(xml) ? 'italic' : undefined,
    textDecoration: [underline ? 'underline' : '', strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
  })
}

function parsePreviewFill(xml: string): DocumentTemplatePreviewCellStyle {
  const patternFill = xml.match(/<patternFill\b[^>]*(?:\/>|>[\s\S]*?<\/patternFill>)/)?.[0]
  const patternType = patternFill ? parseXmlAttributes(patternFill).get('patternType') : undefined
  if (!patternFill || patternType === 'none') return {}
  return compactPreviewCellStyle({
    backgroundColor: getPreviewXmlColor(patternFill.match(/<fgColor\b[^>]*\/?>/)?.[0]),
  })
}

function parsePreviewBorder(xml: string): DocumentTemplatePreviewCellStyle {
  return compactPreviewCellStyle({
    borderTop: getPreviewXmlBorder(xml, 'top'),
    borderRight: getPreviewXmlBorder(xml, 'right'),
    borderBottom: getPreviewXmlBorder(xml, 'bottom'),
    borderLeft: getPreviewXmlBorder(xml, 'left'),
  })
}

function parsePreviewCellFormat(
  xml: string,
  fonts: DocumentTemplatePreviewCellStyle[],
  fills: DocumentTemplatePreviewCellStyle[],
  borders: DocumentTemplatePreviewCellStyle[],
) {
  const attrs = parseXmlAttributes(xml)
  const alignmentTag = xml.match(/<alignment\b[^>]*\/?>/)?.[0]
  const alignment = alignmentTag ? parseXmlAttributes(alignmentTag) : new Map<string, string>()
  return compactPreviewCellStyle({
    ...(fonts[Number(attrs.get('fontId') ?? 0)] ?? {}),
    ...(fills[Number(attrs.get('fillId') ?? 0)] ?? {}),
    ...(borders[Number(attrs.get('borderId') ?? 0)] ?? {}),
    textAlign: normalizePreviewHorizontalAlignment(alignment.get('horizontal')),
    verticalAlign: normalizePreviewVerticalAlignment(alignment.get('vertical')),
    whiteSpace: alignment.get('wrapText') === '1' || alignment.get('wrapText') === 'true' ? 'pre-line' : undefined,
  })
}

function getPreviewXmlBorder(xml: string, side: 'top' | 'right' | 'bottom' | 'left') {
  const tag = xml.match(new RegExp(`<${side}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${side}>)`))?.[0]
  if (!tag) return undefined
  const style = parseXmlAttributes(tag).get('style')
  if (!style) return undefined
  const color = getPreviewXmlColor(tag.match(/<color\b[^>]*\/?>/)?.[0]) ?? '#cbd5e1'
  const width = style.toLowerCase().includes('thick') ? 3 : style.toLowerCase().includes('medium') ? 2 : 1
  const lineStyle =
    style.toLowerCase().includes('dash') || style.toLowerCase().includes('dot')
      ? 'dashed'
      : style.toLowerCase().includes('double')
        ? 'double'
        : 'solid'
  return `${width}px ${lineStyle} ${color}`
}

function getPreviewXmlColor(tag: string | undefined) {
  if (!tag) return undefined
  const attrs = parseXmlAttributes(tag)
  const rgb = attrs.get('rgb')
  if (rgb) return normalizePreviewRgb(rgb)
  const indexed = Number(attrs.get('indexed'))
  if (Number.isFinite(indexed)) return PREVIEW_INDEXED_COLORS[indexed]
  return undefined
}

function getXmlElementAttribute(xml: string, element: string, attribute: string) {
  const tag = xml.match(new RegExp(`<${element}\\b[^>]*\\/?>`))?.[0]
  return tag ? parseXmlAttributes(tag).get(attribute) : undefined
}

function normalizePreviewRgb(value: string) {
  const rgb = value.replace(/^#/, '')
  const color = rgb.length === 8 ? rgb.slice(2) : rgb
  return /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : undefined
}

function compactPreviewCellStyle(style: DocumentTemplatePreviewCellStyle) {
  return Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== undefined),
  ) as DocumentTemplatePreviewCellStyle
}

const PREVIEW_INDEXED_COLORS: Record<number, string> = {
  0: '#000000',
  1: '#FFFFFF',
  2: '#FF0000',
  3: '#00FF00',
  4: '#0000FF',
  5: '#FFFF00',
  6: '#FF00FF',
  7: '#00FFFF',
  8: '#000000',
  9: '#FFFFFF',
}

function getPreviewColor(value: unknown) {
  if (!isObjectRecord(value) || typeof value.rgb !== 'string') return undefined
  return normalizePreviewRgb(value.rgb)
}

function getPreviewBorder(value: unknown) {
  if (!isObjectRecord(value) || typeof value.style !== 'string') return undefined
  const color = getPreviewColor(value.color) ?? '#cbd5e1'
  const borderStyle = value.style.toLowerCase()
  const width = borderStyle.includes('thick') ? 3 : borderStyle.includes('medium') ? 2 : 1
  const lineStyle =
    borderStyle.includes('dash') || borderStyle.includes('dot')
      ? 'dashed'
      : borderStyle.includes('double')
        ? 'double'
        : 'solid'
  return `${width}px ${lineStyle} ${color}`
}

function normalizePreviewHorizontalAlignment(value: unknown): DocumentTemplatePreviewCellStyle['textAlign'] {
  if (value === 'center' || value === 'right' || value === 'left') return value
  return undefined
}

function normalizePreviewVerticalAlignment(value: unknown): DocumentTemplatePreviewCellStyle['verticalAlign'] {
  if (value === 'top' || value === 'bottom') return value
  if (value === 'center') return 'middle'
  return undefined
}
