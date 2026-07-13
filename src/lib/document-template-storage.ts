import * as XLSX from 'xlsx-js-style'
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
  fields: string[]
  markerCount: number
  locations: TemplateMarkerLocation[]
  warnings: string[]
}

export type WeldingJournalTemplateOptions = {
  officialOnly: boolean
  goodOnly: boolean
}

export type DocumentTemplateOptions = {
  weldingJournal?: WeldingJournalTemplateOptions
}

export type StoredDocumentTemplate = TemplateUploadInfo & {
  id: DocumentTemplateId
  fileData: ArrayBuffer
  options?: DocumentTemplateOptions
}

export const DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS: WeldingJournalTemplateOptions = {
  officialOnly: false,
  goodOnly: false,
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
      fields: [],
      markerCount: 0,
      locations: [],
      warnings: [
        'Word-шаблон принят, но разбор маркеров .docx подключим отдельным шагом через Word/XML-парсер. Для Excel маркеры уже распознаются автоматически.',
      ],
      fileData,
    }
  }

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
  const warnings: string[] = []
  if (!fields.length) {
    warnings.push('В Excel-шаблоне не найдено маркеров вида {{Поле}}. Проверьте последнюю строку или нужные ячейки шаблона.')
  }

  return {
    fileName: file.name,
    fileType: extension,
    fileSize: file.size,
    uploadedAt: new Date().toLocaleString('ru-RU'),
    fields,
    markerCount: locations.reduce((count, location) => count + location.fields.length, 0),
    locations,
    warnings,
    fileData,
  }
}

export async function saveDocumentTemplate(templateId: DocumentTemplateId, parsedTemplate: TemplateUploadInfo & { fileData: ArrayBuffer }) {
  const existingTemplate = await loadDocumentTemplate(templateId).catch(() => undefined)
  const record: StoredDocumentTemplate = {
    id: templateId,
    ...parsedTemplate,
    options: existingTemplate?.options,
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

export function downloadWeldingJournalFromTemplate(
  template: StoredDocumentTemplate,
  records: WeldInput[],
  periodFrom: string,
  periodTo: string,
  fileName?: string,
  context?: WeldingJournalTemplateContext,
) {
  const blob = createWeldingJournalBlobFromTemplate(template, records, context)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileName || `Сварочный журнал ${periodFrom || 'all'}-${periodTo || 'all'}`}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function createWeldingJournalBlobFromTemplate(
  template: StoredDocumentTemplate,
  records: WeldInput[],
  context: WeldingJournalTemplateContext = {},
) {
  const workbook = XLSX.read(template.fileData, { type: 'array', cellStyles: true })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) throw new Error('В шаблоне не найден первый лист.')

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
  })
  return new Blob([preservedWorkbookData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
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

function collectTemplateMarkerCells(worksheet: XLSX.WorkSheet) {
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

function getTemplateCellText(cell: XLSX.CellObject | undefined) {
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
  if (mappedKey === '__index') return recordIndex + 1
  if (mappedKey === '__welderName') return formatTemplateFieldValue(getWelderNamesForOfficialStamps(record, context.welderStamps ?? []), marker.fallback)
  if (isTemplateStampWelderNameField(mappedKey)) {
    return formatTemplateFieldValue(
      getWelderNameForTemplateStamp(record, mappedKey.replace('__welderName:', '') as TemplateStampNameFieldKey, context.welderStamps ?? []),
      marker.fallback,
    )
  }

  const field = WELD_FIELDS.find((candidate) => candidate.key === mappedKey)
  const value = record[mappedKey]
  if (field?.kind === 'date') return formatTemplateFieldValue(formatExportDate(value), marker.fallback)
  if (field?.kind === 'number') return formatTemplateFieldValue(formatExportNumber(value), marker.fallback)
  if (field?.kind === 'boolean') return formatTemplateFieldValue(formatControlAvailabilityForExport(value), marker.fallback)
  return formatTemplateFieldValue(value, marker.fallback)
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

function expandWorksheetRef(worksheet: XLSX.WorkSheet, maxRow: number, maxColumn: number) {
  const currentRange = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }
  currentRange.e.r = Math.max(currentRange.e.r, maxRow)
  currentRange.e.c = Math.max(currentRange.e.c, maxColumn)
  worksheet['!ref'] = XLSX.utils.encode_range(currentRange)
}

function shiftWorksheetRows(worksheet: XLSX.WorkSheet, startRow: number, offset: number) {
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

function copyWorksheetRow(worksheet: XLSX.WorkSheet, sourceRow: number, targetRow: number, startColumn: number, endColumn: number) {
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

function copyWorksheetRowMerges(worksheet: XLSX.WorkSheet, sourceRow: number, targetRow: number) {
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

function enableAutoRowHeight(worksheet: XLSX.WorkSheet, row: number) {
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

function cloneTemplateRowCell(sourceCell: XLSX.CellObject) {
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
    } satisfies XLSX.CellObject
  }

  return clonedCell
}

function hasCellStyle(style: unknown) {
  return isObjectRecord(style) && Object.keys(style).length > 0
}

function hasCellContent(cell: XLSX.CellObject) {
  return cell.v !== undefined && cell.v !== null && String(cell.v) !== ''
}

type WorkbookXmlPreservationContext = {
  markerRow: number
  recordCount: number
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

    const templateSheetPath = getFirstWorksheetPath(templateCfb)
    const generatedSheetPath = getFirstWorksheetPath(generatedCfb)
    const templateSheetXml = readCfbText(templateCfb, templateSheetPath)
    const generatedSheetXml = readCfbText(generatedCfb, generatedSheetPath)
    if (templateSheetXml && generatedSheetXml) {
      const styleByCell = extractCellStyleMap(templateSheetXml)
      const patchedSheetXml = clearGeneratedRowHeights(
        applyTemplateCellStyles(generatedSheetXml, styleByCell, context),
        context,
      )
      writeCfbText(generatedCfb, generatedSheetPath, patchedSheetXml)
    }

    return XLSX.CFB.write(generatedCfb, { type: 'array', fileType: 'zip' }) as ArrayBuffer
  } catch {
    return generatedData
  }
}

function copyCfbFile(sourceCfb: XLSX.CFB.CFB$Container, targetCfb: XLSX.CFB.CFB$Container, path: string) {
  const sourceIndex = findCfbFileIndex(sourceCfb, path)
  const targetIndex = findCfbFileIndex(targetCfb, path)
  if (sourceIndex < 0 || targetIndex < 0) return
  targetCfb.FileIndex[targetIndex].content = new Uint8Array(sourceCfb.FileIndex[sourceIndex].content)
}

function readCfbText(cfb: XLSX.CFB.CFB$Container, path: string) {
  const index = findCfbFileIndex(cfb, path)
  if (index < 0) return ''
  return new TextDecoder().decode(cfb.FileIndex[index].content)
}

function writeCfbText(cfb: XLSX.CFB.CFB$Container, path: string, value: string) {
  const index = findCfbFileIndex(cfb, path)
  if (index < 0) return
  cfb.FileIndex[index].content = new TextEncoder().encode(value)
  cfb.FileIndex[index].size = cfb.FileIndex[index].content.length
}

function findCfbFileIndex(cfb: XLSX.CFB.CFB$Container, path: string) {
  const normalizedPath = path.replace(/^\/+/, '')
  return cfb.FullPaths.findIndex((fullPath) => fullPath.replace(/^Root Entry\//, '') === normalizedPath)
}

function getFirstWorksheetPath(cfb: XLSX.CFB.CFB$Container) {
  const worksheetPath =
    cfb.FullPaths.map((fullPath) => fullPath.replace(/^Root Entry\//, ''))
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
      .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))[0] ?? 'xl/worksheets/sheet1.xml'
  return worksheetPath
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

function clearGeneratedRowHeights(sheetXml: string, { markerRow, recordCount }: WorkbookXmlPreservationContext) {
  const generatedStartRow = markerRow + 1
  const generatedEndRow = generatedStartRow + Math.max(recordCount - 1, 0)
  return sheetXml.replace(/<row\b[^>]*>/g, (tag) => {
    const rowNumber = Number(parseXmlAttributes(tag).get('r'))
    if (!Number.isFinite(rowNumber) || rowNumber < generatedStartRow || rowNumber > generatedEndRow) return tag
    return removeXmlAttribute(removeXmlAttribute(tag, 'ht'), 'customHeight')
  })
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
