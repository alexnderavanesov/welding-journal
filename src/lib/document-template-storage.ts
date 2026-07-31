import type * as XLSXTypes from 'xlsx-js-style'
import { FIELD_BY_LABEL, normalizeHeader, WELD_FIELDS, type WeldInput } from '@/lib/weld-fields'
import { formatControlAvailabilityForExport } from '@/lib/report-value-utils'
import { formatExportDate, formatExportNumber } from '@/lib/weld-export-utils'
import {
  STAMP_NAME_TEMPLATE_FIELDS,
  getWelderNameForTemplateStamp,
  getWelderNamesForOfficialStamps,
  type TemplateStampNameFieldKey,
} from '@/lib/welder-stamp-names'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export const DOCUMENT_TEMPLATE_STORAGE_EVENT = 'document-template-storage-change'

type XlsxModule = typeof import('xlsx-js-style')

let XLSX = null as unknown as XlsxModule
let xlsxModule: XlsxModule | null = null
let xlsxModulePromise: Promise<XlsxModule> | null = null

async function loadXlsxJsStyle() {
  if (xlsxModule) return xlsxModule
  xlsxModulePromise ??= import('xlsx-js-style').then((module) => {
    XLSX = module
    xlsxModule = module
    return module
  })
  return xlsxModulePromise
}

const DOCUMENT_TEMPLATE_DB_NAME = 'welding-document-templates'
const DOCUMENT_TEMPLATE_STORE_NAME = 'templates'
export const DOCUMENT_TEMPLATE_TYPES = [
  {
    id: 'weldingJournal',
    label: 'Сварочный журнал',
    description: 'Периодический журнал сваренных стыков.',
  },
  {
    id: 'lnkRequest',
    label: 'Заявка ЛНК',
    description: 'Шаблон заявки на контроль.',
  },
  {
    id: 'lnkConclusion',
    label: 'Заключение ЛНК',
    description: 'Шаблон заключения по результатам НК.',
  },
  {
    id: 'psto',
    label: 'ПСТО',
    description: 'Шаблон документов по термообработке.',
  },
] as const

export type DocumentTemplateId = (typeof DOCUMENT_TEMPLATE_TYPES)[number]['id']

export type TemplateMarkerLocation = {
  sheet: string
  cell: string
  source: string
  fields: string[]
}

export type TemplateUploadInfo = {
  fileName: string
  fileType: string
  fileSize: number
  uploadedAt: string
  sheetNames?: string[]
  fields: string[]
  markerCount: number
  locations: TemplateMarkerLocation[]
  warnings: string[]
}

export type WeldingJournalTemplateOptions = {
  officialOnly: boolean
  goodOnly: boolean
  actualOnly: boolean
}

export type DocumentTemplateOptions = {
  weldingJournal?: WeldingJournalTemplateOptions
}

export type DocumentTemplateFieldKey =
  | keyof WeldInput
  | '__index'
  | '__welderName'
  | `__welderName:${TemplateStampNameFieldKey}`

export type DocumentTemplateBindingMode = 'row' | 'list' | 'uniqueList' | 'count' | 'sum'

export type DocumentTemplateEmptyMode = 'blank' | 'np' | 'custom'

export type DocumentTemplateCellPart = {
  field: DocumentTemplateFieldKey
  prefix?: string
  suffix?: string
  lineBreakAfter?: boolean
}

export type DocumentTemplateCellBinding = {
  cell: string
  mode: DocumentTemplateBindingMode
  field?: DocumentTemplateFieldKey
  parts?: DocumentTemplateCellPart[]
  uniqueParts?: boolean
  separator?: 'comma' | 'newline' | 'custom'
  customSeparator?: string
  emptyMode?: DocumentTemplateEmptyMode
  emptyText?: string
}

export type DocumentTemplateConstructorConfig = {
  version: 1
  sheetName: string
  repeatRow?: number
  bindings: DocumentTemplateCellBinding[]
}

export type StoredDocumentTemplate = TemplateUploadInfo & {
  id: DocumentTemplateId
  fileData: ArrayBuffer
  options?: DocumentTemplateOptions
  constructorConfig?: DocumentTemplateConstructorConfig
}

export type DocumentTemplatePreviewCell = {
  address: string
  row: number
  column: number
  value: string
  rowSpan: number
  columnSpan: number
  style: DocumentTemplatePreviewCellStyle
}

export type DocumentTemplatePreviewCellStyle = {
  backgroundColor?: string
  color?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  fontStyle?: 'italic'
  textDecoration?: string
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  whiteSpace?: 'normal' | 'pre-line'
  borderTop?: string
  borderRight?: string
  borderBottom?: string
  borderLeft?: string
}

export type DocumentTemplateWorkbookPreview = {
  sheetNames: string[]
  sheetName: string
  startRow: number
  startColumn: number
  rowCount: number
  columnCount: number
  cells: DocumentTemplatePreviewCell[]
  hiddenCells: string[]
  columnWidths: number[]
  rowHeights: number[]
  truncated: boolean
}

export const DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS: WeldingJournalTemplateOptions = {
  officialOnly: false,
  goodOnly: false,
  actualOnly: false,
}

export function getWeldingJournalTemplateOptions(
  options?: Partial<WeldingJournalTemplateOptions>,
): WeldingJournalTemplateOptions {
  return {
    ...DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS,
    ...options,
  }
}

type TemplateMarkerCell = {
  address: string
  row: number
  column: number
  source: string
  fields: string[]
}

type TemplateSystemField = '__index' | '__welderName' | `__welderName:${TemplateStampNameFieldKey}`

type WeldingJournalTemplateContext = {
  welderStamps?: WelderStampRecord[]
}

const TEMPLATE_FIELD_ALIASES = new Map<string, keyof WeldInput | TemplateSystemField>([
  [normalizeTemplateFieldName('№'), '__index'],
  [normalizeTemplateFieldName('№ п/п'), '__index'],
  [normalizeTemplateFieldName('N'), '__index'],
  [normalizeTemplateFieldName('Номер'), '__index'],
  [normalizeTemplateFieldName('ФИО сварщика'), '__welderName'],
])

for (const field of STAMP_NAME_TEMPLATE_FIELDS) {
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(`${field.label}ФИО сварщика`), `__welderName:${field.key}`)
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(`${field.label} ФИО сварщика`), `__welderName:${field.key}`)
}

for (const field of WELD_FIELDS) {
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(field.label), field.key as keyof WeldInput)
}

for (const [label, field] of FIELD_BY_LABEL.entries()) {
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(label), field.key as keyof WeldInput)
}

export async function parseDocumentTemplateFile(file: File): Promise<TemplateUploadInfo & { fileData: ArrayBuffer }> {
  const extension = getFileExtension(file.name)
  if (!['xlsx', 'xls', 'docx'].includes(extension)) {
    throw new Error('Поддерживаются только шаблоны .xlsx, .xls и .docx.')
  }

  const fileData = await file.arrayBuffer()

  if (extension === 'docx') {
    return {
      fileName: file.name,
      fileType: extension,
      fileSize: file.size,
      uploadedAt: new Date().toLocaleString('ru-RU'),
      sheetNames: [],
      fields: [],
      markerCount: 0,
      locations: [],
      warnings: [
        'Word-шаблон принят, но разбор маркеров .docx подключим отдельным шагом через Word/XML-парсер. Для Excel маркеры уже распознаются автоматически.',
      ],
      fileData,
    }
  }

  const XLSX = await loadXlsxJsStyle()
  const workbook = XLSX.read(fileData, { type: 'array' })
  const fieldSet = new Set<string>()
  const locations: TemplateMarkerLocation[] = []

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    for (const markerCell of collectTemplateMarkerCells(sheet)) {
      markerCell.fields.forEach((field) => fieldSet.add(field))
      locations.push({
        sheet: sheetName,
        cell: markerCell.address,
        source: markerCell.source,
        fields: markerCell.fields,
      })
    }
  })

  const fields = Array.from(fieldSet).sort((left, right) => left.localeCompare(right, 'ru'))
  return {
    fileName: file.name,
    fileType: extension,
    fileSize: file.size,
    uploadedAt: new Date().toLocaleString('ru-RU'),
    sheetNames: [...workbook.SheetNames],
    fields,
    markerCount: locations.reduce((count, location) => count + location.fields.length, 0),
    locations,
    warnings: [],
    fileData,
  }
}

export async function saveDocumentTemplate(templateId: DocumentTemplateId, parsedTemplate: TemplateUploadInfo & { fileData: ArrayBuffer }) {
  const existingTemplate = await loadDocumentTemplate(templateId).catch(() => undefined)
  const record: StoredDocumentTemplate = {
    id: templateId,
    ...parsedTemplate,
    options: existingTemplate?.options,
    constructorConfig: undefined,
  }
  const db = await openDocumentTemplateDb()
  await runStoreRequest(db, 'readwrite', (store) => store.put(record))
  notifyDocumentTemplateStorageChanged()
  return record
}

export async function updateDocumentTemplateConstructor(
  templateId: DocumentTemplateId,
  constructorConfig: DocumentTemplateConstructorConfig,
) {
  const existingTemplate = await loadDocumentTemplate(templateId)
  if (!existingTemplate) return null

  const record: StoredDocumentTemplate = {
    ...existingTemplate,
    constructorConfig,
  }
  const db = await openDocumentTemplateDb()
  await runStoreRequest(db, 'readwrite', (store) => store.put(record))
  notifyDocumentTemplateStorageChanged()
  return record
}

export async function updateDocumentTemplateOptions(templateId: DocumentTemplateId, options: DocumentTemplateOptions) {
  const existingTemplate = await loadDocumentTemplate(templateId)
  if (!existingTemplate) return null

  const record: StoredDocumentTemplate = {
    ...existingTemplate,
    options: {
      ...existingTemplate.options,
      ...options,
    },
  }
  const db = await openDocumentTemplateDb()
  await runStoreRequest(db, 'readwrite', (store) => store.put(record))
  notifyDocumentTemplateStorageChanged()
  return record
}

export async function loadDocumentTemplate(templateId: DocumentTemplateId) {
  const db = await openDocumentTemplateDb()
  return runStoreRequest<StoredDocumentTemplate | undefined>(db, 'readonly', (store) => store.get(templateId))
}

export async function loadDocumentTemplates() {
  const db = await openDocumentTemplateDb()
  const records = await runStoreRequest<StoredDocumentTemplate[]>(db, 'readonly', (store) => store.getAll())
  return records.reduce<Partial<Record<DocumentTemplateId, StoredDocumentTemplate>>>((accumulator, record) => {
    accumulator[record.id] = record
    return accumulator
  }, {})
}

export async function deleteDocumentTemplate(templateId: DocumentTemplateId) {
  const db = await openDocumentTemplateDb()
  await runStoreRequest(db, 'readwrite', (store) => store.delete(templateId))
  notifyDocumentTemplateStorageChanged()
}

export async function downloadWeldingJournalFromTemplate(
  template: StoredDocumentTemplate,
  records: WeldInput[],
  periodFrom: string,
  periodTo: string,
  fileName?: string,
  context?: WeldingJournalTemplateContext,
) {
  const blob = await createWeldingJournalBlobFromTemplate(template, records, context)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileName || `Сварочный журнал ${periodFrom || 'all'}-${periodTo || 'all'}`}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function createWeldingJournalBlobFromTemplate(
  template: StoredDocumentTemplate,
  records: WeldInput[],
  context: WeldingJournalTemplateContext = {},
) {
  const XLSX = await loadXlsxJsStyle()
  const workbook = XLSX.read(template.fileData, { type: 'array', cellStyles: true })
  const constructorConfig = template.constructorConfig
  const sheetName =
    constructorConfig?.sheetName && workbook.SheetNames.includes(constructorConfig.sheetName)
      ? constructorConfig.sheetName
      : workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) throw new Error('В шаблоне не найден выбранный лист.')

  if (constructorConfig?.bindings.length) {
    return createWeldingJournalBlobFromConstructor(template, workbook, worksheet, records, constructorConfig, context)
  }

  const markerCells = collectTemplateMarkerCells(worksheet)
  if (!markerCells.length) throw new Error('В шаблоне не найдено строки с маркерами вида {{Поле}}.')

  const markerRow = getPrimaryMarkerRow(markerCells)
  const repeatedCells = markerCells.filter((cell) => cell.row === markerRow)
  if (!repeatedCells.length) throw new Error('Не удалось определить строку для заполнения сварочного журнала.')

  const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : { s: { r: markerRow, c: 0 }, e: { r: markerRow, c: 0 } }
  const extraRows = Math.max(records.length - 1, 0)
  if (extraRows > 0) shiftWorksheetRows(worksheet, markerRow + 1, extraRows)

  records.forEach((record, recordIndex) => {
    const targetRow = markerRow + recordIndex
    copyWorksheetRow(worksheet, markerRow, targetRow, range.s.c, range.e.c)
    copyWorksheetRowMerges(worksheet, markerRow, targetRow)

    for (const markerCell of repeatedCells) {
      const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: markerCell.column })
      const originalCell = worksheet[markerCell.address]
      const value = replaceTemplateMarkers(markerCell.source, record, recordIndex, context)
      worksheet[targetAddress] = {
        ...originalCell,
        t: typeof value === 'number' ? 'n' : 's',
        v: value,
        w: undefined,
        s: cloneCellStyle(originalCell?.s),
      }
    }
    enableAutoRowHeight(worksheet, targetRow)
  })

  expandWorksheetRef(worksheet, markerRow + Math.max(records.length - 1, 0), Math.max(range.e.c, ...repeatedCells.map((cell) => cell.column)))
  const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
  const preservedWorkbookData = preserveTemplateWorkbookXml(template.fileData, workbookData, {
    markerRow,
    recordCount: records.length,
    sheetIndex: workbook.SheetNames.indexOf(sheetName),
  })
  return new Blob([preservedWorkbookData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

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
  const XLSX = await loadXlsxJsStyle()
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

function extractXmlCollection(xml: string, collectionName: string, itemName: string) {
  const collection = xml.match(new RegExp(`<${collectionName}\\b[^>]*>([\\s\\S]*?)<\\/${collectionName}>`))?.[1] ?? ''
  const items: string[] = []
  let cursor = 0

  while (cursor < collection.length) {
    const start = collection.indexOf(`<${itemName}`, cursor)
    if (start < 0) break
    const startTagEnd = collection.indexOf('>', start)
    if (startTagEnd < 0) break
    const startTag = collection.slice(start, startTagEnd + 1)
    if (/\/>\s*$/.test(startTag)) {
      items.push(startTag)
      cursor = startTagEnd + 1
      continue
    }

    const closingTag = `</${itemName}>`
    const end = collection.indexOf(closingTag, startTagEnd + 1)
    if (end < 0) break
    items.push(collection.slice(start, end + closingTag.length))
    cursor = end + closingTag.length
  }

  return items
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

async function createWeldingJournalBlobFromConstructor(
  template: StoredDocumentTemplate,
  workbook: XLSXTypes.WorkBook,
  worksheet: XLSXTypes.WorkSheet,
  records: WeldInput[],
  config: DocumentTemplateConstructorConfig,
  context: WeldingJournalTemplateContext,
) {
  const XLSX = await loadXlsxJsStyle()
  const repeatRowIndex = config.repeatRow ? config.repeatRow - 1 : undefined
  const rowBindings = config.bindings.filter((binding) => binding.mode === 'row')
  const aggregateBindings = config.bindings.filter((binding) => binding.mode !== 'row')

  if (rowBindings.length && repeatRowIndex === undefined) {
    throw new Error('В конструкторе не выбрана строка, которая должна повторяться для каждого стыка.')
  }
  if (repeatRowIndex !== undefined) {
    for (const binding of rowBindings) {
      if (XLSX.utils.decode_cell(binding.cell).r !== repeatRowIndex) {
        throw new Error(`Поле ${binding.cell} должно находиться в повторяемой строке ${config.repeatRow}.`)
      }
    }
    for (const binding of aggregateBindings) {
      if (XLSX.utils.decode_cell(binding.cell).r >= repeatRowIndex) {
        throw new Error(`Сводное поле ${binding.cell} должно находиться выше повторяемой строки ${config.repeatRow}.`)
      }
    }
  }

  const initialRange = worksheet['!ref']
    ? XLSX.utils.decode_range(worksheet['!ref'])
    : { s: { r: repeatRowIndex ?? 0, c: 0 }, e: { r: repeatRowIndex ?? 0, c: 0 } }

  for (const binding of aggregateBindings) {
    writeConstructorCell(
      worksheet,
      binding.cell,
      getConstructorAggregateValue(binding, records, context),
    )
  }

  if (repeatRowIndex !== undefined && rowBindings.length) {
    const extraRows = Math.max(records.length - 1, 0)
    if (extraRows > 0) shiftWorksheetRows(worksheet, repeatRowIndex + 1, extraRows)

    const sourceCells = new Map(
      rowBindings.map((binding) => {
        const sourceCell = worksheet[binding.cell]
        return [binding.cell, sourceCell ? cloneTemplateRowCell(sourceCell) : undefined] as const
      }),
    )

    const rowsToWrite = records.length ? records : [null]
    rowsToWrite.forEach((record, recordIndex) => {
      const targetRow = repeatRowIndex + recordIndex
      copyWorksheetRow(worksheet, repeatRowIndex, targetRow, initialRange.s.c, initialRange.e.c)
      copyWorksheetRowMerges(worksheet, repeatRowIndex, targetRow)

      for (const binding of rowBindings) {
        const decoded = XLSX.utils.decode_cell(binding.cell)
        const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: decoded.c })
        const sourceCell = sourceCells.get(binding.cell)
        if (sourceCell) worksheet[targetAddress] = cloneTemplateRowCell(sourceCell)
        const value = record
          ? getConstructorRowValue(binding, record, recordIndex, context)
          : applyConstructorEmptyValue('', binding)
        writeConstructorCell(worksheet, targetAddress, value)
      }
      enableAutoRowHeight(worksheet, targetRow)
    })

    expandWorksheetRef(
      worksheet,
      repeatRowIndex + Math.max(records.length - 1, 0),
      initialRange.e.c,
    )
  }

  const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
  const preservedWorkbookData =
    repeatRowIndex === undefined
      ? workbookData
      : preserveTemplateWorkbookXml(template.fileData, workbookData, {
          markerRow: repeatRowIndex,
          recordCount: records.length,
          sheetIndex: workbook.SheetNames.indexOf(config.sheetName),
        })
  return new Blob([preservedWorkbookData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function writeConstructorCell(worksheet: XLSXTypes.WorkSheet, address: string, value: string | number) {
  const originalCell = worksheet[address]
  worksheet[address] = {
    ...originalCell,
    t: typeof value === 'number' ? 'n' : 's',
    v: value,
    w: undefined,
    s: cloneCellStyle(originalCell?.s),
  }
}

function getConstructorRowValue(
  binding: DocumentTemplateCellBinding,
  record: WeldInput,
  recordIndex: number,
  context: WeldingJournalTemplateContext,
) {
  const parts = getConstructorBindingParts(binding)
  if (parts.length) {
    const singlePart = parts[0]
    if (
      parts.length === 1 &&
      !binding.uniqueParts &&
      !singlePart.prefix &&
      !singlePart.suffix &&
      !singlePart.lineBreakAfter
    ) {
      return applyConstructorEmptyValue(
        getTemplateFieldValueByKey(singlePart.field, record, recordIndex, context),
        binding,
      )
    }
    const seenValues = new Set<string>()
    const value = parts
      .map((part) => {
        const rawValue = getTemplateFieldValueByKey(part.field, record, recordIndex, context)
        const normalizedValue = String(rawValue ?? '').trim()
        if (!normalizedValue) return ''
        const uniqueKey = normalizedValue.toLocaleLowerCase('ru')
        if (binding.uniqueParts && seenValues.has(uniqueKey)) return ''
        seenValues.add(uniqueKey)
        return `${part.prefix ?? ''}${normalizedValue}${part.suffix ?? ''}${part.lineBreakAfter ? '\n' : ''}`
      })
      .join('')
      .replace(/\n+$/, '')
    return applyConstructorEmptyValue(value, binding)
  }
  if (!binding.field) return applyConstructorEmptyValue('', binding)
  const value = getTemplateFieldValueByKey(binding.field, record, recordIndex, context)
  return applyConstructorEmptyValue(value, binding)
}

function getConstructorBindingParts(binding: DocumentTemplateCellBinding) {
  if (binding.parts?.length) return binding.parts
  return binding.mode === 'row' && binding.field ? [{ field: binding.field }] : []
}

function getConstructorAggregateValue(
  binding: DocumentTemplateCellBinding,
  records: WeldInput[],
  context: WeldingJournalTemplateContext,
) {
  if (binding.mode === 'count') return records.length

  const field = binding.field
  if (!field) return applyConstructorEmptyValue('', binding)
  if (binding.mode === 'sum') {
    const total = records.reduce((sum, record, recordIndex) => {
      const value = getTemplateFieldValueByKey(field, record, recordIndex, context)
      const numericValue = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
      return sum + (Number.isFinite(numericValue) ? numericValue : 0)
    }, 0)
    return Math.round(total * 1000) / 1000
  }

  const values = records
    .map((record, recordIndex) => getTemplateFieldValueByKey(field, record, recordIndex, context))
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
  const outputValues =
    binding.mode === 'uniqueList'
      ? Array.from(new Map(values.map((value) => [value.toLocaleLowerCase('ru'), value])).values())
      : values
  const separator =
    binding.separator === 'newline'
      ? '\n'
      : binding.separator === 'custom'
        ? binding.customSeparator || ', '
        : ', '
  return applyConstructorEmptyValue(outputValues.join(separator), binding)
}

function applyConstructorEmptyValue(value: unknown, binding: DocumentTemplateCellBinding) {
  if (typeof value === 'number') return value
  if (String(value ?? '').trim()) return String(value)
  if (binding.emptyMode === 'np') return 'н/п'
  if (binding.emptyMode === 'custom') return binding.emptyText ?? ''
  return ''
}

export function extractTemplateFields(source: string) {
  const fields: string[] = []
  const markerPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
  let marker: RegExpExecArray | null

  while ((marker = markerPattern.exec(source)) !== null) {
    const fieldName = parseTemplateMarkerToken(marker[1] ?? '').fieldName
    if (isKnownTemplateMarkerField(fieldName)) fields.push(fieldName)
  }

  return fields
}

export function isKnownTemplateMarkerField(fieldName: string) {
  return TEMPLATE_FIELD_ALIASES.has(normalizeTemplateFieldName(fieldName))
}

export function parseTemplateMarkerToken(token: string) {
  const normalized = normalizeHeader(token)
  const fallbackMatch = normalized.match(/^(.*?)\/\s*(?:"([^"]*)"|'([^']*)'|«([^»]*)»|“([^”]*)”)\s*$/)
  if (!fallbackMatch) return { fieldName: normalized, fallback: undefined }

  const fieldName = normalizeHeader(fallbackMatch[1])
  if (!fieldName) return { fieldName: normalized, fallback: undefined }

  return {
    fieldName,
    fallback: fallbackMatch[2] ?? fallbackMatch[3] ?? fallbackMatch[4] ?? fallbackMatch[5] ?? '',
  }
}

export function getFileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`
  return `${(size / 1024 / 1024).toFixed(1)} МБ`
}

function collectTemplateMarkerCells(worksheet: XLSXTypes.WorkSheet) {
  if (!worksheet['!ref']) return []

  const range = XLSX.utils.decode_range(worksheet['!ref'])
  const markerCells: TemplateMarkerCell[] = []
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      const cell = worksheet[address]
      const rawValue = getTemplateCellText(cell)
      if (rawValue === undefined || rawValue === null) continue

      const source = String(rawValue)
      const fields = extractTemplateFields(source)
      if (!fields.length) continue

      markerCells.push({
        address,
        row,
        column,
        source,
        fields,
      })
    }
  }
  return markerCells
}

function getTemplateCellText(cell: XLSXTypes.CellObject | undefined) {
  if (!cell) return undefined
  if (typeof cell.v === 'string') return cell.v
  return cell.w ?? cell.v
}

function getPrimaryMarkerRow(markerCells: TemplateMarkerCell[]) {
  const rowCounts = new Map<number, number>()
  for (const cell of markerCells) {
    rowCounts.set(cell.row, (rowCounts.get(cell.row) ?? 0) + cell.fields.length)
  }

  return Array.from(rowCounts.entries()).sort((left, right) => {
    const countDelta = right[1] - left[1]
    if (countDelta !== 0) return countDelta
    return right[0] - left[0]
  })[0][0]
}

function replaceTemplateMarkers(source: string, record: WeldInput, recordIndex: number, context: WeldingJournalTemplateContext) {
  const singleMarker = source.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/)
  if (singleMarker) return getTemplateFieldValue(singleMarker[1], record, recordIndex, context)

  return source.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, fieldName: string) =>
    String(getTemplateFieldValue(fieldName, record, recordIndex, context) ?? ''),
  )
}

function getTemplateFieldValue(fieldName: string, record: WeldInput, recordIndex: number, context: WeldingJournalTemplateContext) {
  const marker = parseTemplateMarkerToken(fieldName)
  const mappedKey = TEMPLATE_FIELD_ALIASES.get(normalizeTemplateFieldName(marker.fieldName))
  if (!mappedKey) return ''
  return formatTemplateFieldValue(getTemplateFieldValueByKey(mappedKey, record, recordIndex, context), marker.fallback)
}

function getTemplateFieldValueByKey(
  mappedKey: DocumentTemplateFieldKey,
  record: WeldInput,
  recordIndex: number,
  context: WeldingJournalTemplateContext,
) {
  if (mappedKey === '__index') return recordIndex + 1
  if (mappedKey === '__welderName') return getWelderNamesForOfficialStamps(record, context.welderStamps ?? [])
  if (isTemplateStampWelderNameField(mappedKey)) {
    return getWelderNameForTemplateStamp(
      record,
      mappedKey.replace('__welderName:', '') as TemplateStampNameFieldKey,
      context.welderStamps ?? [],
    )
  }

  const field = WELD_FIELDS.find((candidate) => candidate.key === mappedKey)
  const value = record[mappedKey]
  if (field?.kind === 'date') return formatExportDate(value)
  if (field?.kind === 'number') return formatExportNumber(value)
  if (field?.kind === 'boolean') return formatControlAvailabilityForExport(value)
  return value
}

function formatTemplateFieldValue(value: unknown, fallback: string | undefined) {
  if (typeof value === 'number') return value
  return String(value ?? '').trim() ? value : fallback ?? ''
}

function isTemplateStampWelderNameField(value: keyof WeldInput | TemplateSystemField): value is `__welderName:${TemplateStampNameFieldKey}` {
  return typeof value === 'string' && value.startsWith('__welderName:')
}

function normalizeTemplateFieldName(value: string) {
  return normalizeHeader(value).replace(/[{}]/g, '').trim()
}

function expandWorksheetRef(worksheet: XLSXTypes.WorkSheet, maxRow: number, maxColumn: number) {
  const currentRange = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }
  currentRange.e.r = Math.max(currentRange.e.r, maxRow)
  currentRange.e.c = Math.max(currentRange.e.c, maxColumn)
  worksheet['!ref'] = XLSX.utils.encode_range(currentRange)
}

function shiftWorksheetRows(worksheet: XLSXTypes.WorkSheet, startRow: number, offset: number) {
  if (offset <= 0 || !worksheet['!ref']) return

  const range = XLSX.utils.decode_range(worksheet['!ref'])
  for (let row = range.e.r; row >= startRow; row -= 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const sourceAddress = XLSX.utils.encode_cell({ r: row, c: column })
      const targetAddress = XLSX.utils.encode_cell({ r: row + offset, c: column })
      if (worksheet[sourceAddress]) {
        worksheet[targetAddress] = worksheet[sourceAddress]
        delete worksheet[sourceAddress]
      } else {
        delete worksheet[targetAddress]
      }
    }
  }

  if (worksheet['!rows']) {
    for (let row = worksheet['!rows'].length - 1; row >= startRow; row -= 1) {
      worksheet['!rows'][row + offset] = worksheet['!rows'][row]
      delete worksheet['!rows'][row]
    }
  }

  if (worksheet['!merges']) {
    worksheet['!merges'] = worksheet['!merges'].map((merge) => {
      const nextMerge = {
        s: { ...merge.s },
        e: { ...merge.e },
      }
      if (nextMerge.s.r >= startRow) nextMerge.s.r += offset
      if (nextMerge.e.r >= startRow) nextMerge.e.r += offset
      return nextMerge
    })
  }

  range.e.r += offset
  worksheet['!ref'] = XLSX.utils.encode_range(range)
}

function copyWorksheetRow(worksheet: XLSXTypes.WorkSheet, sourceRow: number, targetRow: number, startColumn: number, endColumn: number) {
  for (let column = startColumn; column <= endColumn; column += 1) {
    const sourceAddress = XLSX.utils.encode_cell({ r: sourceRow, c: column })
    const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: column })
    const sourceCell = worksheet[sourceAddress]
    if (sourceCell) {
      worksheet[targetAddress] = cloneTemplateRowCell(sourceCell)
    } else {
      delete worksheet[targetAddress]
    }
  }

  if (worksheet['!rows']?.[sourceRow]) {
    worksheet['!rows'][targetRow] = { ...worksheet['!rows'][sourceRow] }
  }
}

function copyWorksheetRowMerges(worksheet: XLSXTypes.WorkSheet, sourceRow: number, targetRow: number) {
  if (sourceRow === targetRow || !worksheet['!merges']) return

  const sourceMerges = worksheet['!merges'].filter((merge) => merge.s.r === sourceRow && merge.e.r === sourceRow)
  if (!sourceMerges.length) return

  const existingKeys = new Set(worksheet['!merges'].map((merge) => `${merge.s.r}:${merge.s.c}:${merge.e.r}:${merge.e.c}`))
  for (const merge of sourceMerges) {
    const nextMerge = {
      s: { r: targetRow, c: merge.s.c },
      e: { r: targetRow, c: merge.e.c },
    }
    const key = `${nextMerge.s.r}:${nextMerge.s.c}:${nextMerge.e.r}:${nextMerge.e.c}`
    if (!existingKeys.has(key)) worksheet['!merges'].push(nextMerge)
  }
}

function enableAutoRowHeight(worksheet: XLSXTypes.WorkSheet, row: number) {
  const rowInfo = worksheet['!rows']?.[row]
  if (!rowInfo) return

  delete rowInfo.hpt
  delete rowInfo.hpx
  delete (rowInfo as Record<string, unknown>).customHeight
  if (Object.keys(rowInfo).length === 0 && worksheet['!rows']) delete worksheet['!rows'][row]
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneCellStyle(style: unknown) {
  if (!isObjectRecord(style)) return {}
  return JSON.parse(JSON.stringify(style)) as Record<string, unknown>
}

function cloneTemplateRowCell(sourceCell: XLSXTypes.CellObject) {
  const clonedCell = {
    ...sourceCell,
    s: cloneCellStyle(sourceCell.s),
  }

  if (hasCellStyle(sourceCell.s) && !hasCellContent(sourceCell)) {
    return {
      ...clonedCell,
      t: 's',
      v: '',
      w: undefined,
    } satisfies XLSXTypes.CellObject
  }

  return clonedCell
}

function hasCellStyle(style: unknown) {
  return isObjectRecord(style) && Object.keys(style).length > 0
}

function hasCellContent(cell: XLSXTypes.CellObject) {
  return cell.v !== undefined && cell.v !== null && String(cell.v) !== ''
}

type WorkbookXmlPreservationContext = {
  markerRow: number
  recordCount: number
  sheetIndex: number
}

function preserveTemplateWorkbookXml(
  templateData: ArrayBuffer,
  generatedData: ArrayBuffer,
  context: WorkbookXmlPreservationContext,
) {
  try {
    const templateCfb = XLSX.CFB.read(new Uint8Array(templateData), { type: 'array' })
    const generatedCfb = XLSX.CFB.read(new Uint8Array(generatedData), { type: 'array' })
    copyCfbFile(templateCfb, generatedCfb, 'xl/styles.xml')
    copyCfbFile(templateCfb, generatedCfb, 'xl/theme/theme1.xml')
    copyCfbFile(templateCfb, generatedCfb, '[Content_Types].xml')
    copyCfbDirectory(templateCfb, generatedCfb, 'xl/media/')
    copyCfbDirectory(templateCfb, generatedCfb, 'xl/drawings/')

    const templateSheetPath = getWorksheetPath(templateCfb, context.sheetIndex)
    const generatedSheetPath = getWorksheetPath(generatedCfb, context.sheetIndex)
    copyCfbFile(templateCfb, generatedCfb, getWorksheetRelationshipsPath(templateSheetPath))
    const templateSheetXml = readCfbText(templateCfb, templateSheetPath)
    const generatedSheetXml = readCfbText(generatedCfb, generatedSheetPath)
    if (templateSheetXml && generatedSheetXml) {
      const styleByCell = extractCellStyleMap(templateSheetXml)
      const styledSheetXml = applyTemplateCellStyles(generatedSheetXml, styleByCell, context)
      const wrappedWorkbook = ensureGeneratedMultilineCellWrapping(
        styledSheetXml,
        readCfbText(templateCfb, 'xl/styles.xml'),
        context,
      )
      const patchedSheetXml = preserveWorksheetDrawingReferences(
        templateSheetXml,
        applyGeneratedRowAutoHeights(
          wrappedWorkbook.sheetXml,
          wrappedWorkbook.stylesXml,
          context,
        ),
      )
      if (wrappedWorkbook.stylesXml) writeCfbText(generatedCfb, 'xl/styles.xml', wrappedWorkbook.stylesXml)
      writeCfbText(generatedCfb, generatedSheetPath, patchedSheetXml)
    }

    return XLSX.CFB.write(generatedCfb, { type: 'array', fileType: 'zip' }) as ArrayBuffer
  } catch {
    return generatedData
  }
}

type CfbContainer = {
  FullPaths: string[]
  FileIndex: Array<{ content: Uint8Array; size: number }>
}

function copyCfbFile(sourceCfb: CfbContainer, targetCfb: CfbContainer, path: string) {
  const sourceIndex = findCfbFileIndex(sourceCfb, path)
  const targetIndex = findCfbFileIndex(targetCfb, path)
  if (sourceIndex < 0) return
  const content = new Uint8Array(sourceCfb.FileIndex[sourceIndex].content)
  if (targetIndex < 0) {
    XLSX.CFB.utils.cfb_add(targetCfb as never, path.replace(/^\/+/, ''), content)
    return
  }
  targetCfb.FileIndex[targetIndex].content = content
  targetCfb.FileIndex[targetIndex].size = content.length
}

function copyCfbDirectory(sourceCfb: CfbContainer, targetCfb: CfbContainer, directory: string) {
  const normalizedDirectory = directory.replace(/^\/+/, '')
  for (const fullPath of sourceCfb.FullPaths) {
    const normalizedPath = fullPath.replace(/^Root Entry\//, '')
    if (normalizedPath.startsWith(normalizedDirectory) && !normalizedPath.endsWith('/')) {
      copyCfbFile(sourceCfb, targetCfb, normalizedPath)
    }
  }
}

function readCfbText(cfb: CfbContainer, path: string) {
  const index = findCfbFileIndex(cfb, path)
  if (index < 0) return ''
  return new TextDecoder().decode(cfb.FileIndex[index].content)
}

function writeCfbText(cfb: CfbContainer, path: string, value: string) {
  const index = findCfbFileIndex(cfb, path)
  if (index < 0) return
  cfb.FileIndex[index].content = new TextEncoder().encode(value)
  cfb.FileIndex[index].size = cfb.FileIndex[index].content.length
}

function findCfbFileIndex(cfb: CfbContainer, path: string) {
  const normalizedPath = path.replace(/^\/+/, '')
  return cfb.FullPaths.findIndex((fullPath) => fullPath.replace(/^Root Entry\//, '') === normalizedPath)
}

function getWorksheetPath(cfb: CfbContainer, sheetIndex: number) {
  const worksheetPaths = cfb.FullPaths
    .map((fullPath) => fullPath.replace(/^Root Entry\//, ''))
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))
  return worksheetPaths[Math.max(0, sheetIndex)] ?? worksheetPaths[0] ?? 'xl/worksheets/sheet1.xml'
}

function getWorksheetRelationshipsPath(worksheetPath: string) {
  const fileName = worksheetPath.split('/').pop() ?? 'sheet1.xml'
  return `xl/worksheets/_rels/${fileName}.rels`
}

function preserveWorksheetDrawingReferences(templateSheetXml: string, generatedSheetXml: string) {
  const referenceTags = templateSheetXml.match(/<(?:drawing|legacyDrawing|legacyDrawingHF)\b[^>]*\/>/g) ?? []
  if (!referenceTags.length) return generatedSheetXml

  let nextXml = generatedSheetXml
  for (const tag of referenceTags) {
    const relationshipId = parseXmlAttributes(tag).get('r:id')
    if (relationshipId && nextXml.includes(`r:id="${relationshipId}"`)) continue
    nextXml = nextXml.replace(/<\/worksheet>$/, `${tag}</worksheet>`)
  }
  return nextXml
}

function extractCellStyleMap(sheetXml: string) {
  const styleByCell = new Map<string, string>()
  for (const tag of sheetXml.match(/<c\b[^>]*>/g) ?? []) {
    const attrs = parseXmlAttributes(tag)
    const cellRef = attrs.get('r')
    const styleId = attrs.get('s')
    if (!cellRef || styleId === undefined) continue
    const decoded = decodeCellReference(cellRef)
    if (!decoded) continue
    styleByCell.set(`${decoded.row}:${decoded.column}`, styleId)
  }
  return styleByCell
}

function applyTemplateCellStyles(
  sheetXml: string,
  styleByCell: Map<string, string>,
  { markerRow, recordCount }: WorkbookXmlPreservationContext,
) {
  const extraRows = Math.max(recordCount - 1, 0)
  const generatedStartRow = markerRow + 1
  const generatedEndRow = generatedStartRow + Math.max(recordCount - 1, 0)

  const styledSheetXml = sheetXml.replace(/<c\b[^>]*>/g, (tag) => {
    const attrs = parseXmlAttributes(tag)
    const cellRef = attrs.get('r')
    if (!cellRef) return tag

    const decoded = decodeCellReference(cellRef)
    if (!decoded) return tag

    const sourceRow =
      decoded.row < generatedStartRow
        ? decoded.row
        : decoded.row <= generatedEndRow
          ? generatedStartRow
          : decoded.row - extraRows
    const styleId = styleByCell.get(`${sourceRow}:${decoded.column}`)
    return styleId === undefined ? removeXmlAttribute(tag, 's') : setXmlAttribute(tag, 's', styleId)
  })

  return ensureGeneratedStyledEmptyCells(styledSheetXml, styleByCell, {
    markerRow,
    recordCount,
  })
}

function ensureGeneratedStyledEmptyCells(
  sheetXml: string,
  styleByCell: Map<string, string>,
  { markerRow, recordCount }: WorkbookXmlPreservationContext,
) {
  const generatedStartRow = markerRow + 1
  const generatedEndRow = generatedStartRow + Math.max(recordCount - 1, 0)
  const styleByColumn = new Map<number, string>()

  for (const entry of Array.from(styleByCell.entries())
    .map(([key, styleId]) => {
      const [row, column] = key.split(':').map(Number)
      return row === generatedStartRow && Number.isFinite(column) ? { column, styleId } : null
    })
    .filter((entry): entry is { column: number; styleId: string } => Boolean(entry))
    .sort((left, right) => left.column - right.column)) {
    if (!styleByColumn.has(entry.column)) styleByColumn.set(entry.column, entry.styleId)
  }

  for (const rowXml of sheetXml.match(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g) ?? []) {
    const rowNumber = Number(parseXmlAttributes(rowXml).get('r'))
    if (!Number.isFinite(rowNumber) || rowNumber < generatedStartRow || rowNumber > generatedEndRow) continue

    for (const cellTag of rowXml.match(/<c\b[^>]*>/g) ?? []) {
      const attrs = parseXmlAttributes(cellTag)
      const cellRef = attrs.get('r')
      const styleId = attrs.get('s')
      const decoded = cellRef ? decodeCellReference(cellRef) : null
      if (decoded && styleId !== undefined && !styleByColumn.has(decoded.column)) styleByColumn.set(decoded.column, styleId)
    }
  }

  if (!styleByColumn.size) return sheetXml

  return sheetXml.replace(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g, (rowXml) => {
    const rowAttrs = parseXmlAttributes(rowXml)
    const rowNumber = Number(rowAttrs.get('r'))
    if (!Number.isFinite(rowNumber) || rowNumber < generatedStartRow || rowNumber > generatedEndRow) return rowXml

    const existingColumns = new Set<number>()
    const styledRowXml = rowXml.replace(/<c\b[^>]*>/g, (cellTag) => {
      const cellRef = parseXmlAttributes(cellTag).get('r')
      const decoded = cellRef ? decodeCellReference(cellRef) : null
      if (decoded) existingColumns.add(decoded.column)
      const styleId = decoded ? styleByColumn.get(decoded.column) : undefined
      return styleId === undefined ? cellTag : setXmlAttribute(cellTag, 's', styleId)
    })

    const missingCells = Array.from(styleByColumn.entries())
      .sort((left, right) => left[0] - right[0])
      .filter(([column]) => !existingColumns.has(column))
      .map(([column, styleId]) => `<c r="${encodeCellReference(rowNumber, column)}" s="${escapeXmlAttribute(styleId)}"/>`)
      .join('')

    if (!missingCells) return styledRowXml
    if (/\/>$/.test(styledRowXml)) return styledRowXml.replace(/\/>$/, `>${missingCells}</row>`)
    return styledRowXml.replace(/<\/row>$/, `${missingCells}</row>`)
  })
}

function ensureGeneratedMultilineCellWrapping(
  sheetXml: string,
  stylesXml: string,
  { markerRow, recordCount }: WorkbookXmlPreservationContext,
) {
  const generatedStartRow = markerRow + 1
  const generatedEndRow = generatedStartRow + Math.max(recordCount - 1, 0)
  const cellFormats = extractXmlCollection(stylesXml, 'cellXfs', 'xf')
  if (!cellFormats.length) return { sheetXml, stylesXml }

  const wrappedStyleIds = new Map<number, number>()
  const nextFormats = [...cellFormats]
  const nextSheetXml = sheetXml.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g, (cellXml) => {
    const openingTag = cellXml.match(/^<c\b[^>]*>/)?.[0]
    if (!openingTag) return cellXml
    const attrs = parseXmlAttributes(openingTag)
    const cellRef = attrs.get('r')
    const decoded = cellRef ? decodeCellReference(cellRef) : null
    if (!decoded || decoded.row < generatedStartRow || decoded.row > generatedEndRow) return cellXml
    if (!extractWorksheetCellText(cellXml).includes('\n')) return cellXml

    const sourceStyleId = Number(attrs.get('s') ?? 0)
    if (!Number.isFinite(sourceStyleId) || !nextFormats[sourceStyleId]) return cellXml
    if (cellFormatWrapsText(nextFormats[sourceStyleId])) return cellXml

    let wrappedStyleId = wrappedStyleIds.get(sourceStyleId)
    if (wrappedStyleId === undefined) {
      wrappedStyleId = nextFormats.length
      wrappedStyleIds.set(sourceStyleId, wrappedStyleId)
      nextFormats.push(addWrapTextToCellFormat(nextFormats[sourceStyleId]))
    }
    return cellXml.replace(openingTag, setXmlAttribute(openingTag, 's', String(wrappedStyleId)))
  })

  if (!wrappedStyleIds.size) return { sheetXml: nextSheetXml, stylesXml }
  return {
    sheetXml: nextSheetXml,
    stylesXml: replaceCellFormats(stylesXml, nextFormats),
  }
}

function replaceCellFormats(stylesXml: string, cellFormats: string[]) {
  return stylesXml.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, (collectionXml) => {
    const openingTag = collectionXml.match(/^<cellXfs\b[^>]*>/)?.[0]
    if (!openingTag) return collectionXml
    return `${setXmlAttribute(openingTag, 'count', String(cellFormats.length))}${cellFormats.join('')}</cellXfs>`
  })
}

function addWrapTextToCellFormat(cellFormat: string) {
  const openingTag = cellFormat.match(/^<xf\b[^>]*\/?>/)?.[0]
  if (!openingTag) return cellFormat
  const alignedOpeningTag = setXmlAttribute(openingTag, 'applyAlignment', '1')
  const alignmentTag = cellFormat.match(/<alignment\b[^>]*\/?>/)?.[0]
  if (alignmentTag) {
    return cellFormat
      .replace(openingTag, alignedOpeningTag)
      .replace(alignmentTag, setXmlAttribute(alignmentTag, 'wrapText', '1'))
  }
  if (/\/>$/.test(alignedOpeningTag)) {
    return `${alignedOpeningTag.replace(/\/>$/, '>')}<alignment wrapText="1"/></xf>`
  }
  return cellFormat
    .replace(openingTag, alignedOpeningTag)
    .replace(/<\/xf>$/, '<alignment wrapText="1"/></xf>')
}

function cellFormatWrapsText(cellFormat: string) {
  const alignmentTag = cellFormat.match(/<alignment\b[^>]*\/?>/)?.[0]
  if (!alignmentTag) return false
  const wrapText = parseXmlAttributes(alignmentTag).get('wrapText')
  return wrapText === '1' || wrapText === 'true'
}

function applyGeneratedRowAutoHeights(
  sheetXml: string,
  stylesXml: string,
  { markerRow, recordCount }: WorkbookXmlPreservationContext,
) {
  const generatedStartRow = markerRow + 1
  const generatedEndRow = generatedStartRow + Math.max(recordCount - 1, 0)
  const columnWidths = extractWorksheetColumnWidths(sheetXml)
  const mergeColumnSpans = extractWorksheetMergeColumnSpans(sheetXml)
  const cellFormats = extractXmlCollection(stylesXml, 'cellXfs', 'xf')

  return sheetXml.replace(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g, (rowXml) => {
    const openingTag = rowXml.match(/^<row\b[^>]*>/)?.[0]
    if (!openingTag) return rowXml
    const rowNumber = Number(parseXmlAttributes(openingTag).get('r'))
    if (!Number.isFinite(rowNumber) || rowNumber < generatedStartRow || rowNumber > generatedEndRow) return rowXml

    let requiredLines = 1
    for (const cellXml of rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const cellOpeningTag = cellXml.match(/^<c\b[^>]*>/)?.[0]
      if (!cellOpeningTag) continue
      const attrs = parseXmlAttributes(cellOpeningTag)
      const cellRef = attrs.get('r')
      const decoded = cellRef ? decodeCellReference(cellRef) : null
      if (!decoded) continue
      const text = extractWorksheetCellText(cellXml)
      if (!text) continue
      const styleId = Number(attrs.get('s') ?? 0)
      const wrapsText = text.includes('\n') || cellFormatWrapsText(cellFormats[styleId] ?? '')
      if (!wrapsText) continue
      const columnSpan = mergeColumnSpans.get(cellRef ?? '') ?? 1
      const availableCharacters = Array.from(
        { length: columnSpan },
        (_, index) => columnWidths.get(decoded.column + index) ?? 12,
      ).reduce((total, width) => total + Math.max(width - 1, 1), 0)
      const lineCount = text.split('\n').reduce(
        (total, line) => total + Math.max(1, Math.ceil(Math.max(line.length, 1) / Math.max(availableCharacters, 1))),
        0,
      )
      requiredLines = Math.max(requiredLines, lineCount)
    }

    const clearedOpeningTag = removeXmlAttribute(removeXmlAttribute(openingTag, 'ht'), 'customHeight')
    if (requiredLines <= 1) return rowXml.replace(openingTag, clearedOpeningTag)
    const existingHeight = Number(parseXmlAttributes(openingTag).get('ht') ?? 0)
    const calculatedHeight = Math.min(Math.max(requiredLines * 15 + 3, existingHeight, 18), 409)
    const fittedOpeningTag = setXmlAttribute(
      setXmlAttribute(clearedOpeningTag, 'ht', String(calculatedHeight)),
      'customHeight',
      '1',
    )
    return rowXml.replace(openingTag, fittedOpeningTag)
  })
}

function extractWorksheetColumnWidths(sheetXml: string) {
  const widths = new Map<number, number>()
  for (const tag of sheetXml.match(/<col\b[^>]*\/?>/g) ?? []) {
    const attrs = parseXmlAttributes(tag)
    const start = Number(attrs.get('min'))
    const end = Number(attrs.get('max'))
    const width = Number(attrs.get('width'))
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(width)) continue
    for (let column = start; column <= end; column += 1) widths.set(column, width)
  }
  return widths
}

function extractWorksheetMergeColumnSpans(sheetXml: string) {
  const spans = new Map<string, number>()
  for (const tag of sheetXml.match(/<mergeCell\b[^>]*\/?>/g) ?? []) {
    const range = parseXmlAttributes(tag).get('ref')
    const [startRef, endRef] = range?.split(':') ?? []
    const start = startRef ? decodeCellReference(startRef) : null
    const end = endRef ? decodeCellReference(endRef) : null
    if (!start || !end) continue
    spans.set(startRef, Math.max(end.column - start.column + 1, 1))
  }
  return spans
}

function extractWorksheetCellText(cellXml: string) {
  const value = cellXml.match(/<(?:v|t)\b[^>]*>([\s\S]*?)<\/(?:v|t)>/)?.[1] ?? ''
  return decodeXmlText(value)
}

function decodeXmlText(value: string) {
  return value
    .replace(/&#(?:10|x0*A);?/gi, '\n')
    .replace(/_x000A_/gi, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\r\n?/g, '\n')
}

function parseXmlAttributes(tag: string) {
  const attrs = new Map<string, string>()
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs.set(match[1], match[2])
  }
  return attrs
}

function setXmlAttribute(tag: string, name: string, value: string) {
  const escapedValue = escapeXmlAttribute(value)
  return new RegExp(`\\s${escapeRegExp(name)}="[^"]*"`).test(tag)
    ? tag.replace(new RegExp(`(\\s${escapeRegExp(name)}=")[^"]*(")`), `$1${escapedValue}$2`)
    : tag.replace(/\/?>$/, (ending) => ` ${name}="${escapedValue}"${ending}`)
}

function removeXmlAttribute(tag: string, name: string) {
  return tag.replace(new RegExp(`\\s${escapeRegExp(name)}="[^"]*"`, 'g'), '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeXmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function decodeCellReference(value: string) {
  const match = value.match(/^([A-Z]+)(\d+)$/i)
  if (!match) return null
  return {
    column: decodeColumnReference(match[1]),
    row: Number(match[2]),
  }
}

function decodeColumnReference(value: string) {
  return value
    .toUpperCase()
    .split('')
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0)
}

function encodeCellReference(row: number, column: number) {
  return `${encodeColumnReference(column)}${row}`
}

function encodeColumnReference(column: number) {
  let value = ''
  let current = column
  while (current > 0) {
    const remainder = (current - 1) % 26
    value = String.fromCharCode(65 + remainder) + value
    current = Math.floor((current - 1) / 26)
  }
  return value
}

function openDocumentTemplateDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DOCUMENT_TEMPLATE_DB_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть хранилище шаблонов.'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DOCUMENT_TEMPLATE_STORE_NAME)) {
        db.createObjectStore(DOCUMENT_TEMPLATE_STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

function runStoreRequest<T = void>(db: IDBDatabase, mode: IDBTransactionMode, createRequest: (store: IDBObjectStore) => IDBRequest) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(DOCUMENT_TEMPLATE_STORE_NAME, mode)
    const store = transaction.objectStore(DOCUMENT_TEMPLATE_STORE_NAME)
    const request = createRequest(store)
    request.onerror = () => reject(request.error ?? new Error('Не удалось выполнить операцию с шаблоном.'))
    request.onsuccess = () => resolve(request.result as T)
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? new Error('Не удалось сохранить шаблон.'))
    }
  })
}

function notifyDocumentTemplateStorageChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(DOCUMENT_TEMPLATE_STORAGE_EVENT))
}
