import * as XLSX from 'xlsx'
import { FIELD_BY_LABEL, normalizeHeader, WELD_FIELDS, type WeldInput } from '@/lib/weld-fields'
import { formatControlAvailabilityForExport } from '@/lib/report-value-utils'
import { formatExportDate, formatExportNumber } from '@/lib/weld-export-utils'

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

const TEMPLATE_FIELD_ALIASES = new Map<string, keyof WeldInput | '__index'>([
  [normalizeTemplateFieldName('№'), '__index'],
  [normalizeTemplateFieldName('№ п/п'), '__index'],
  [normalizeTemplateFieldName('N'), '__index'],
  [normalizeTemplateFieldName('Номер'), '__index'],
])

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
      const value = replaceTemplateMarkers(markerCell.source, record, recordIndex)
      worksheet[targetAddress] = {
        ...originalCell,
        t: typeof value === 'number' ? 'n' : 's',
        v: value,
        w: undefined,
        s: withWrappedCellStyle(originalCell?.s),
      }
    }
    applyGeneratedRowHeight(worksheet, targetRow, range.s.c, range.e.c)
  })

  expandWorksheetRef(worksheet, markerRow + Math.max(records.length - 1, 0), Math.max(range.e.c, ...repeatedCells.map((cell) => cell.column)))
  XLSX.writeFile(workbook, `${fileName || `Сварочный журнал ${periodFrom || 'all'}-${periodTo || 'all'}`}.xlsx`)
}

export function extractTemplateFields(source: string) {
  const fields: string[] = []
  const markerPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
  let marker: RegExpExecArray | null

  while ((marker = markerPattern.exec(source)) !== null) {
    const fieldName = marker[1]?.trim()
    if (fieldName) fields.push(fieldName)
  }

  return fields
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

function replaceTemplateMarkers(source: string, record: WeldInput, recordIndex: number) {
  const singleMarker = source.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/)
  if (singleMarker) return getTemplateFieldValue(singleMarker[1], record, recordIndex)

  return source.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, fieldName: string) => String(getTemplateFieldValue(fieldName, record, recordIndex) ?? ''))
}

function getTemplateFieldValue(fieldName: string, record: WeldInput, recordIndex: number) {
  const mappedKey = TEMPLATE_FIELD_ALIASES.get(normalizeTemplateFieldName(fieldName))
  if (!mappedKey) return ''
  if (mappedKey === '__index') return recordIndex + 1

  const field = WELD_FIELDS.find((candidate) => candidate.key === mappedKey)
  const value = record[mappedKey]
  if (field?.kind === 'date') return formatExportDate(value)
  if (field?.kind === 'number') return formatExportNumber(value)
  if (field?.kind === 'boolean') return formatControlAvailabilityForExport(value)
  return value ?? ''
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
  if (sourceRow === targetRow) return

  for (let column = startColumn; column <= endColumn; column += 1) {
    const sourceAddress = XLSX.utils.encode_cell({ r: sourceRow, c: column })
    const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: column })
    const sourceCell = worksheet[sourceAddress]
    if (sourceCell) {
      worksheet[targetAddress] = {
        ...sourceCell,
        s: withWrappedCellStyle(sourceCell.s),
      }
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

function withWrappedCellStyle(style: unknown) {
  const baseStyle = isObjectRecord(style) ? style : {}
  const alignment = isObjectRecord(baseStyle.alignment) ? baseStyle.alignment : {}
  return {
    ...baseStyle,
    alignment: {
      ...alignment,
      wrapText: true,
    },
  }
}

function applyGeneratedRowHeight(worksheet: XLSX.WorkSheet, row: number, startColumn: number, endColumn: number) {
  let maxLines = 1
  for (let column = startColumn; column <= endColumn; column += 1) {
    const address = XLSX.utils.encode_cell({ r: row, c: column })
    const value = worksheet[address]?.v
    if (value === undefined || value === null) continue
    const lines = String(value).split(/\r\n|\r|\n/).length
    maxLines = Math.max(maxLines, lines)
  }

  if (!worksheet['!rows']) worksheet['!rows'] = []
  const sourceRowHeight = worksheet['!rows'][row]?.hpt ?? 18
  worksheet['!rows'][row] = {
    ...worksheet['!rows'][row],
    hpt: Math.max(sourceRowHeight, 18 * maxLines),
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
