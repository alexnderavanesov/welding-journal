import type * as XLSXTypes from 'xlsx-js-style'
import { FIELD_BY_KEY, FIELD_BY_LABEL, isVirtualWeldField, normalizeHeader, WELD_FIELDS, type WeldInput } from '@/lib/weld-fields'
import { formatControlAvailabilityForExport } from '@/lib/report-value-utils'
import { formatExportDate, formatExportNumber } from '@/lib/weld-export-utils'
import {
  STAMP_NAME_TEMPLATE_FIELDS,
  getWelderNameForTemplateStamp,
  getWelderNamesForOfficialStamps,
  type TemplateStampNameFieldKey,
} from '@/lib/welder-stamp-names'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import {
  isWeldingJournalDocumentSplitMode,
  type WeldingJournalDocumentSplitMode,
} from '@/lib/welding-journal-document-splitting'
import {
  DOCUMENT_FORMATION_DATE_TOKEN,
  DOCUMENT_SEQUENCE_NUMBER_TOKEN,
} from '@/lib/generated-document-naming'
import { getGeneratedDocumentProfile, isGeneratedDocumentType } from '@/lib/generated-document-types'
import {
  getSystemDocumentRowResult,
  type SystemDocumentTemplateContext,
} from '@/lib/system-document-types'
import {
  deleteRemoteDocumentTemplate,
  getRemoteDocumentTemplate,
  listRemoteDocumentTemplates,
  saveRemoteDocumentTemplate,
  updateRemoteDocumentTemplate,
} from '@/server/document-templates'

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

export const DOCUMENT_TEMPLATE_TYPES = [
  {
    id: 'weldingJournal',
    label: 'ЖСР',
    description: 'Журнал сварочных работ по выбранным стыкам.',
  },
  {
    id: 'checklist',
    label: 'Чек-лист',
    description: 'Чек-лист по выбранным стыкам.',
  },
  {
    id: 'zni',
    label: 'ЗНИ',
    description: 'Запрос на инспекцию по выбранным стыкам.',
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
    id: 'pstoRequest',
    label: 'Заявка ПСТО',
    description: 'Шаблон заявки на проведение термообработки.',
  },
  {
    id: 'pstoConclusion',
    label: 'Заключение ПСТО',
    description: 'Шаблон заключения по результатам термообработки.',
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
  splitMode: WeldingJournalDocumentSplitMode
}

export type DocumentTemplateOptions = {
  weldingJournal?: WeldingJournalTemplateOptions
  checklist?: WeldingJournalTemplateOptions
  zni?: WeldingJournalTemplateOptions
}

export type DocumentTemplateFieldKey =
  | keyof WeldInput
  | '__index'
  | '__welderName'
  | `__welderName:${TemplateStampNameFieldKey}`
  | '__systemDocumentTitle'
  | '__systemDocumentDate'
  | '__systemDocumentNumber'
  | '__systemDocumentMethods'
  | '__systemDocumentResult'

export type DocumentTemplateBindingMode = 'row' | 'summary'
export type DocumentTemplateRepeatMode = 'rows' | 'groups'
export type DocumentTemplateBindingScope = 'document' | 'group'

export type DocumentTemplateEmptyMode = 'blank' | 'np' | 'custom'
export type DocumentTemplateFilledMode = 'value' | 'custom'
export type DocumentTemplateNumericOperation = 'min' | 'max'

export type DocumentTemplateCellPart = {
  field: DocumentTemplateFieldKey
  numericOperation?: DocumentTemplateNumericOperation
  compareField?: DocumentTemplateFieldKey
  multiplier?: string
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
  uniqueValues?: boolean
  separator?: 'comma' | 'newline' | 'custom'
  customSeparator?: string
  scope?: DocumentTemplateBindingScope
  emptyMode?: DocumentTemplateEmptyMode
  emptyText?: string
  filledMode?: DocumentTemplateFilledMode
  filledText?: string
}

export type DocumentTemplateNameFieldKey =
  | keyof WeldInput
  | '__periodFrom'
  | '__periodTo'
  | '__formationDate'
  | '__documentNumber'

export type DocumentTemplateNamePart = {
  type: 'text' | 'field'
  text?: string
  field?: DocumentTemplateNameFieldKey
}

export type DocumentTemplateNameConfig = {
  parts: DocumentTemplateNamePart[]
}

export type DocumentTemplateConstructorConfig = {
  version: 1
  sheetName: string
  repeatRow?: number
  repeatRowEnd?: number
  repeatMode?: DocumentTemplateRepeatMode
  repeatGroupBy?: DocumentTemplateFieldKey
  bindings: DocumentTemplateCellBinding[]
  nameConfig?: DocumentTemplateNameConfig
}

export function createDefaultDocumentTemplateNameConfig(
  templateId: DocumentTemplateId = 'weldingJournal',
): DocumentTemplateNameConfig {
  const documentLabel =
    templateId === 'weldingJournal'
      ? 'Сварочный журнал'
      : isGeneratedDocumentType(templateId)
        ? getGeneratedDocumentProfile(templateId).label
        : 'Документ'
  return {
    parts: [
      { type: 'field', field: 'subtitleCode' },
      { type: 'text', text: ` - ${documentLabel} - ` },
      { type: 'field', field: '__periodFrom' },
      { type: 'text', text: ' - ' },
      { type: 'field', field: '__periodTo' },
    ],
  }
}

export function normalizeDocumentTemplateConstructorConfig(
  config: DocumentTemplateConstructorConfig,
): DocumentTemplateConstructorConfig {
  const repeatRow = config.repeatRow && config.repeatRow > 0 ? Math.floor(config.repeatRow) : undefined
  const repeatRowEnd =
    repeatRow === undefined
      ? undefined
      : Math.max(repeatRow, Math.floor(config.repeatRowEnd || repeatRow))
  const collapsedJointGrouping =
    config.repeatMode === 'groups' && config.repeatGroupBy === 'joint'
  const repeatMode =
    config.repeatMode === 'groups' && !collapsedJointGrouping ? 'groups' : 'rows'
  const usesCurrentGroup = (binding: DocumentTemplateCellBinding) => {
    if (repeatMode !== 'groups' || binding.mode !== 'summary' || !repeatRow || !repeatRowEnd) return false
    const bindingRow = decodeCellReference(binding.cell)?.row ?? 0
    return bindingRow >= repeatRow && bindingRow <= repeatRowEnd
  }
  return {
    ...config,
    repeatRow,
    repeatRowEnd,
    repeatMode,
    repeatGroupBy: repeatMode === 'groups' ? config.repeatGroupBy : undefined,
    nameConfig: config.nameConfig
      ? {
          parts: config.nameConfig.parts.map((part) => ({ ...part })),
        }
      : undefined,
    bindings: config.bindings.flatMap((binding) => {
      const legacyBinding = binding as Omit<DocumentTemplateCellBinding, 'mode'> & {
        mode: DocumentTemplateBindingMode | 'list' | 'uniqueList' | 'count' | 'sum'
        sourceCell?: string
      }
      const { sourceCell: _legacySourceCell, ...bindingWithoutSource } = legacyBinding
      if (legacyBinding.mode === 'count' || legacyBinding.mode === 'sum') return []
      if (legacyBinding.mode !== 'list' && legacyBinding.mode !== 'uniqueList') {
        let normalizedBinding = bindingWithoutSource as DocumentTemplateCellBinding
        if (
          collapsedJointGrouping &&
          normalizedBinding.mode === 'summary' &&
          normalizedBinding.scope === 'group' &&
          repeatRow &&
          repeatRowEnd
        ) {
          const bindingRow = decodeCellReference(normalizedBinding.cell)?.row ?? 0
          if (bindingRow >= repeatRow && bindingRow <= repeatRowEnd) {
            normalizedBinding = {
              ...normalizedBinding,
              mode: 'row',
              uniqueParts: normalizedBinding.uniqueParts ?? normalizedBinding.uniqueValues,
              uniqueValues: undefined,
              scope: undefined,
            }
          }
        }
        const groupBinding = usesCurrentGroup(normalizedBinding)
        return [{
          ...normalizedBinding,
          scope: groupBinding ? 'group' : undefined,
        }]
      }

      return [{
        ...bindingWithoutSource,
        mode: 'summary',
        field: undefined,
        parts: legacyBinding.parts?.length
          ? legacyBinding.parts.map((part) => ({ ...part }))
          : legacyBinding.field
            ? [{ field: legacyBinding.field }]
            : [],
        uniqueValues: legacyBinding.mode === 'uniqueList' ? true : legacyBinding.uniqueValues ?? false,
        scope: undefined,
      }]
    }),
  }
}

export function buildDocumentTemplateName({
  config,
  records,
  periodFrom,
  periodTo,
}: {
  config?: DocumentTemplateNameConfig
  records: WeldInput[]
  periodFrom: string
  periodTo: string
}) {
  const currentConfig = config ?? createDefaultDocumentTemplateNameConfig()
  const value = currentConfig.parts
    .map((part) => {
      if (part.type === 'text') return part.text ?? ''
      if (!part.field) return ''
      if (part.field === '__periodFrom') return formatDocumentNameDate(periodFrom)
      if (part.field === '__periodTo') return formatDocumentNameDate(periodTo)
      if (part.field === '__formationDate') return DOCUMENT_FORMATION_DATE_TOKEN
      if (part.field === '__documentNumber') return DOCUMENT_SEQUENCE_NUMBER_TOKEN

      const field = FIELD_BY_KEY.get(part.field)
      const values = Array.from(
        new Set(
          records
            .map((record) => {
              const rawValue = record[part.field as keyof WeldInput]
              if (rawValue == null || rawValue === '') return ''
              return field?.kind === 'date'
                ? formatDocumentNameDate(String(rawValue))
                : String(rawValue).trim()
            })
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))

      if (values.length <= 3) return values.join(', ')
      return `${values.slice(0, 3).join(', ')} и еще ${values.length - 3}`
    })
    .join('')

  return sanitizeDocumentName(value) || 'Сварочный журнал'
}

function formatDocumentNameDate(value: string) {
  const rawValue = value.trim()
  const isoMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1].slice(-2)}`

  const displayMatch = rawValue.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (displayMatch) return `${displayMatch[1]}.${displayMatch[2]}.${displayMatch[3].slice(-2)}`

  return rawValue
}

function sanitizeDocumentName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
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
  splitMode: 'project',
}

export function getWeldingJournalTemplateOptions(
  options?: Partial<WeldingJournalTemplateOptions>,
): WeldingJournalTemplateOptions {
  return {
    ...DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS,
    ...options,
    splitMode: isWeldingJournalDocumentSplitMode(options?.splitMode) ? options.splitMode : 'project',
  }
}

type TemplateMarkerCell = {
  address: string
  row: number
  column: number
  source: string
  fields: string[]
}

type TemplateSystemField =
  | '__index'
  | '__welderName'
  | `__welderName:${TemplateStampNameFieldKey}`
  | '__systemDocumentTitle'
  | '__systemDocumentDate'
  | '__systemDocumentNumber'
  | '__systemDocumentMethods'
  | '__systemDocumentResult'

export type WeldingJournalTemplateContext = {
  welderStamps?: WelderStampRecord[]
  systemDocument?: SystemDocumentTemplateContext
}

const TEMPLATE_FIELD_ALIASES = new Map<string, keyof WeldInput | TemplateSystemField>([
  [normalizeTemplateFieldName('№'), '__index'],
  [normalizeTemplateFieldName('№ п/п'), '__index'],
  [normalizeTemplateFieldName('N'), '__index'],
  [normalizeTemplateFieldName('Номер'), '__index'],
  [normalizeTemplateFieldName('ФИО сварщика'), '__welderName'],
  [normalizeTemplateFieldName('Наименование системного документа'), '__systemDocumentTitle'],
  [normalizeTemplateFieldName('Дата системного документа'), '__systemDocumentDate'],
  [normalizeTemplateFieldName('№ системного документа'), '__systemDocumentNumber'],
  [normalizeTemplateFieldName('Номер системного документа'), '__systemDocumentNumber'],
  [normalizeTemplateFieldName('Виды контроля системного документа'), '__systemDocumentMethods'],
  [normalizeTemplateFieldName('Результат системного документа'), '__systemDocumentResult'],
])

for (const field of STAMP_NAME_TEMPLATE_FIELDS) {
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(`${field.label}ФИО сварщика`), `__welderName:${field.key}`)
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(`${field.label} ФИО сварщика`), `__welderName:${field.key}`)
}

for (const field of WELD_FIELDS) {
  if (isVirtualWeldField(field)) continue
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(field.label), field.key as keyof WeldInput)
}

for (const [label, field] of FIELD_BY_LABEL.entries()) {
  if (isVirtualWeldField(field)) continue
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
  const remote = await saveRemoteDocumentTemplate({
    data: {
      id: templateId,
      fileName: parsedTemplate.fileName,
      fileType: parsedTemplate.fileType,
      fileSize: parsedTemplate.fileSize,
      fileDataBase64: arrayBufferToBase64(parsedTemplate.fileData),
      sheetNames: parsedTemplate.sheetNames,
      fields: parsedTemplate.fields,
      markerCount: parsedTemplate.markerCount,
      locations: parsedTemplate.locations,
      warnings: parsedTemplate.warnings,
    },
  })
  const record = fromRemoteDocumentTemplate(remote)
  notifyDocumentTemplateStorageChanged()
  return record
}

export async function updateDocumentTemplateConstructor(
  templateId: DocumentTemplateId,
  constructorConfig: DocumentTemplateConstructorConfig,
) {
  const saved = await updateRemoteDocumentTemplate({
    data: {
      id: templateId,
      constructorConfig: normalizeDocumentTemplateConstructorConfig(constructorConfig),
    },
  })
  if (!saved) return null
  const record = await loadDocumentTemplate(templateId)
  notifyDocumentTemplateStorageChanged()
  return record
}

export async function updateDocumentTemplateOptions(templateId: DocumentTemplateId, options: DocumentTemplateOptions) {
  const existingTemplate = await loadDocumentTemplate(templateId)
  if (!existingTemplate) return null

  await updateRemoteDocumentTemplate({
    data: {
      id: templateId,
      options: {
      ...existingTemplate.options,
      ...options,
      },
    },
  })
  const record = await loadDocumentTemplate(templateId)
  notifyDocumentTemplateStorageChanged()
  return record
}

export async function loadDocumentTemplate(templateId: DocumentTemplateId) {
  const remote = await getRemoteDocumentTemplate({ data: { id: templateId } })
  return remote ? fromRemoteDocumentTemplate(remote) : undefined
}

export async function loadDocumentTemplates() {
  const summaries = await listRemoteDocumentTemplates()
  const records = await Promise.all(
    summaries.map(async (summary) => {
      try {
        return await loadDocumentTemplate(summary.id)
      } catch (error) {
        if (
          error instanceof Error
          && error.message.includes('Файл шаблона не найден в общем хранилище')
        ) {
          return undefined
        }
        throw error
      }
    }),
  )
  return records.reduce<Partial<Record<DocumentTemplateId, StoredDocumentTemplate>>>((accumulator, record) => {
    if (record) accumulator[record.id] = record
    return accumulator
  }, {})
}

export async function deleteDocumentTemplate(templateId: DocumentTemplateId) {
  await deleteRemoteDocumentTemplate({ data: { id: templateId } })
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
    return createWeldingJournalBlobFromConstructor(
      template,
      workbook,
      worksheet,
      records,
      normalizeDocumentTemplateConstructorConfig(constructorConfig),
      context,
    )
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

type ConstructorRepeatUnit = {
  record: WeldInput | null
  records: WeldInput[]
}

function getConstructorRepeatUnits(
  records: WeldInput[],
  config: DocumentTemplateConstructorConfig,
): ConstructorRepeatUnit[] {
  if (config.repeatMode !== 'groups' || !config.repeatGroupBy) {
    return records.map((record) => ({ record, records: [record] }))
  }

  const groupingFields = getConstructorGroupingFields(config.repeatGroupBy)
  const groups = new Map<string, WeldInput[]>()
  for (const record of records) {
    const key = groupingFields
      .map((field) => normalizeConstructorGroupValue(record[field as keyof WeldInput]))
      .join('\u001f')
    const groupRecords = groups.get(key) ?? []
    groupRecords.push(record)
    groups.set(key, groupRecords)
  }

  return Array.from(groups.values()).map((groupRecords) => ({
    record: groupRecords[0] ?? null,
    records: groupRecords,
  }))
}

function getConstructorGroupingFields(field: DocumentTemplateFieldKey): DocumentTemplateFieldKey[] {
  if (field === 'projectTitle') return ['projectTitle']
  if (field === 'subtitleCode') return ['projectTitle', 'subtitleCode']
  if (field === 'line') return ['projectTitle', 'subtitleCode', 'line']
  return [field]
}

function normalizeConstructorGroupValue(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ru')
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
  const repeatRowStartIndex = config.repeatRow ? config.repeatRow - 1 : undefined
  const repeatRowEndIndex =
    repeatRowStartIndex === undefined
      ? undefined
      : Math.max(repeatRowStartIndex, (config.repeatRowEnd || config.repeatRow || 1) - 1)
  const repeatBlockHeight =
    repeatRowStartIndex === undefined || repeatRowEndIndex === undefined
      ? 1
      : repeatRowEndIndex - repeatRowStartIndex + 1
  const rowBindings = config.bindings.filter((binding) => binding.mode === 'row')
  const groupBindings = config.bindings.filter(
    (binding) => binding.mode === 'summary' && binding.scope === 'group',
  )
  const aggregateBindings = config.bindings.filter(
    (binding) => binding.mode === 'summary' && binding.scope !== 'group',
  )
  const repeatBindings = [...rowBindings, ...groupBindings]
  const repeatUnits = getConstructorRepeatUnits(records, config)

  if (repeatBindings.length && repeatRowStartIndex === undefined) {
    throw new Error('В конструкторе не выбран блок строк, который должен повторяться для каждого стыка.')
  }
  if (repeatRowStartIndex !== undefined && repeatRowEndIndex !== undefined) {
    for (const binding of repeatBindings) {
      const bindingRow = XLSX.utils.decode_cell(binding.cell).r
      if (bindingRow < repeatRowStartIndex || bindingRow > repeatRowEndIndex) {
        throw new Error(
          `Поле ${binding.cell} должно находиться в повторяемом блоке строк ${config.repeatRow}–${config.repeatRowEnd || config.repeatRow}.`,
        )
      }
    }
    for (const binding of aggregateBindings) {
      if (XLSX.utils.decode_cell(binding.cell).r >= repeatRowStartIndex) {
        throw new Error(`Сводное поле ${binding.cell} должно находиться выше повторяемого блока строк.`)
      }
    }
  }
  if (groupBindings.length && config.repeatMode !== 'groups') {
    throw new Error('Данные текущей группы доступны только когда повторяемый блок настроен по группам.')
  }
  if (config.repeatMode === 'groups' && !config.repeatGroupBy) {
    throw new Error('Выберите поле, по которому должен группироваться повторяемый блок.')
  }
  const initialRange = worksheet['!ref']
    ? XLSX.utils.decode_range(worksheet['!ref'])
    : { s: { r: repeatRowStartIndex ?? 0, c: 0 }, e: { r: repeatRowEndIndex ?? 0, c: 0 } }

  for (const binding of aggregateBindings) {
    writeConstructorCell(
      worksheet,
      binding.cell,
      getConstructorAggregateValue(binding, records, context),
    )
  }

  if (repeatRowStartIndex !== undefined && repeatRowEndIndex !== undefined && repeatBindings.length) {
    assertRepeatBlockMergesAreContained(worksheet, repeatRowStartIndex, repeatRowEndIndex)
    const blockSnapshot = snapshotWorksheetRowBlock(
      worksheet,
      repeatRowStartIndex,
      repeatRowEndIndex,
      initialRange.s.c,
      initialRange.e.c,
    )
    const outputRecordCount = Math.max(repeatUnits.length, 1)
    const extraRows = Math.max(outputRecordCount - 1, 0) * repeatBlockHeight
    if (extraRows > 0) shiftWorksheetRows(worksheet, repeatRowEndIndex + 1, extraRows)

    const sourceCells = new Map(
      repeatBindings.map((binding) => {
        const sourceCell = worksheet[binding.cell]
        return [binding.cell, sourceCell ? cloneTemplateRowCell(sourceCell) : undefined] as const
      }),
    )

    const unitsToWrite = repeatUnits.length
      ? repeatUnits
      : [{ record: null, records: [] }]
    unitsToWrite.forEach((unit, unitIndex) => {
      const targetBlockStart = repeatRowStartIndex + unitIndex * repeatBlockHeight
      restoreWorksheetRowBlock(worksheet, blockSnapshot, targetBlockStart)

      for (const binding of repeatBindings) {
        const decoded = XLSX.utils.decode_cell(binding.cell)
        const targetAddress = XLSX.utils.encode_cell({
          r: targetBlockStart + (decoded.r - repeatRowStartIndex),
          c: decoded.c,
        })
        const sourceCell = sourceCells.get(binding.cell)
        if (sourceCell) worksheet[targetAddress] = cloneTemplateRowCell(sourceCell)
        const value =
          binding.mode === 'row' && unit.record
            ? getConstructorRowValue(binding, unit.record, unitIndex, context)
            : binding.mode === 'summary'
              ? getConstructorAggregateValue(binding, unit.records, context)
              : applyConstructorEmptyValue('', binding)
        writeConstructorCell(worksheet, targetAddress, value)
      }
      for (let rowOffset = 0; rowOffset < repeatBlockHeight; rowOffset += 1) {
        enableAutoRowHeight(worksheet, targetBlockStart + rowOffset)
      }
    })

    expandWorksheetRef(
      worksheet,
      repeatRowStartIndex + outputRecordCount * repeatBlockHeight - 1,
      initialRange.e.c,
    )
  }

  const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
  const preservedWorkbookData =
    repeatRowStartIndex === undefined
      ? workbookData
      : preserveTemplateWorkbookXml(template.fileData, workbookData, {
          markerRow: repeatRowStartIndex,
          markerRowCount: repeatBlockHeight,
          recordCount: repeatUnits.length,
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
        getConstructorPartValue(singlePart, record, recordIndex, context),
        binding,
      )
    }
    const seenValues = new Set<string>()
    const value = parts
      .map((part) => {
        const rawValue = getConstructorPartValue(part, record, recordIndex, context)
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
  return (binding.mode === 'row' || binding.mode === 'summary') && binding.field
    ? [{ field: binding.field }]
    : []
}

function getConstructorAggregateValue(
  binding: DocumentTemplateCellBinding,
  records: WeldInput[],
  context: WeldingJournalTemplateContext,
) {
  const separator = getConstructorListSeparator(binding)
  const value = getConstructorBindingParts(binding)
    .map((part) => {
      const values = records
        .map((record, recordIndex) => getConstructorPartValue(part, record, recordIndex, context))
        .map((partValue) => String(partValue ?? '').trim())
        .filter(Boolean)
      const outputValues =
        binding.uniqueValues === false
          ? values
          : Array.from(
              new Map(values.map((partValue) => [partValue.toLocaleLowerCase('ru'), partValue])).values(),
            )
      if (!outputValues.length) return ''
      return `${part.prefix ?? ''}${outputValues.join(separator)}${part.suffix ?? ''}${part.lineBreakAfter ? '\n' : ''}`
    })
    .join('')
    .replace(/\n+$/, '')
  return applyConstructorEmptyValue(value, binding)
}

function getConstructorListSeparator(binding: DocumentTemplateCellBinding) {
  if (binding.separator === 'newline') return '\n'
  if (binding.separator === 'custom') return binding.customSeparator || ', '
  return ', '
}

function applyConstructorEmptyValue(value: unknown, binding: DocumentTemplateCellBinding) {
  const hasValue = typeof value === 'number' || Boolean(String(value ?? '').trim())
  if (hasValue) {
    if (binding.filledMode === 'custom') return binding.filledText ?? ''
    return typeof value === 'number' ? value : String(value)
  }
  if (binding.emptyMode === 'np') return 'н/п'
  if (binding.emptyMode === 'custom') return binding.emptyText ?? ''
  return ''
}

function getConstructorPartValue(
  part: DocumentTemplateCellPart,
  record: WeldInput,
  recordIndex: number,
  context: WeldingJournalTemplateContext,
) {
  const primaryValue = getTemplateFieldValueByKey(part.field, record, recordIndex, context)
  const hasNumericFormula = Boolean(part.numericOperation || part.multiplier?.trim())
  if (!hasNumericFormula) return primaryValue

  let result = parseConstructorNumericValue(primaryValue)
  if (part.numericOperation) {
    const compareValue = part.compareField
      ? parseConstructorNumericValue(
          getTemplateFieldValueByKey(part.compareField, record, recordIndex, context),
        )
      : undefined
    const values = [result, compareValue].filter((value): value is number => value !== undefined)
    if (!values.length) return ''
    result = part.numericOperation === 'min' ? Math.min(...values) : Math.max(...values)
  }

  if (result === undefined) return ''
  const multiplier = parseConstructorNumericValue(part.multiplier)
  if (part.multiplier?.trim() && multiplier === undefined) return ''
  if (multiplier !== undefined) result *= multiplier
  return roundConstructorNumericValue(result)
}

function parseConstructorNumericValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(',', '.')
  if (!normalized || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function roundConstructorNumericValue(value: number) {
  return Number(value.toFixed(12))
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
  if (mappedKey === '__systemDocumentTitle') return context.systemDocument?.title ?? ''
  if (mappedKey === '__systemDocumentDate') return formatExportDate(context.systemDocument?.date)
  if (mappedKey === '__systemDocumentNumber') return context.systemDocument?.number ?? ''
  if (mappedKey === '__systemDocumentMethods') return context.systemDocument?.methodCodes.join(', ') ?? ''
  if (mappedKey === '__systemDocumentResult') {
    return context.systemDocument
      ? getSystemDocumentRowResult(record, context.systemDocument)
      : ''
  }
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

type WorksheetRowBlockSnapshot = {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  cells: Map<string, XLSXTypes.CellObject>
  rows: Map<number, XLSXTypes.RowInfo>
  merges: XLSXTypes.Range[]
}

function assertRepeatBlockMergesAreContained(
  worksheet: XLSXTypes.WorkSheet,
  startRow: number,
  endRow: number,
) {
  const crossingMerge = (worksheet['!merges'] ?? []).find((merge) => {
    const intersectsBlock = merge.e.r >= startRow && merge.s.r <= endRow
    const containedInBlock = merge.s.r >= startRow && merge.e.r <= endRow
    return intersectsBlock && !containedInBlock
  })
  if (!crossingMerge) return
  throw new Error(
    `Объединение ${XLSX.utils.encode_range(crossingMerge)} пересекает границу повторяемого блока. Включите объединение целиком в блок строк.`,
  )
}

function snapshotWorksheetRowBlock(
  worksheet: XLSXTypes.WorkSheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
): WorksheetRowBlockSnapshot {
  const cells = new Map<string, XLSXTypes.CellObject>()
  const rows = new Map<number, XLSXTypes.RowInfo>()
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      const cell = worksheet[address]
      if (cell) cells.set(`${row - startRow}:${column}`, cloneTemplateRowCell(cell))
    }
    const rowInfo = worksheet['!rows']?.[row]
    if (rowInfo) rows.set(row - startRow, { ...rowInfo })
  }

  return {
    startRow,
    endRow,
    startColumn,
    endColumn,
    cells,
    rows,
    merges: (worksheet['!merges'] ?? [])
      .filter((merge) => merge.s.r >= startRow && merge.e.r <= endRow)
      .map((merge) => ({
        s: { r: merge.s.r - startRow, c: merge.s.c },
        e: { r: merge.e.r - startRow, c: merge.e.c },
      })),
  }
}

function restoreWorksheetRowBlock(
  worksheet: XLSXTypes.WorkSheet,
  snapshot: WorksheetRowBlockSnapshot,
  targetStartRow: number,
) {
  const blockHeight = snapshot.endRow - snapshot.startRow + 1
  for (let rowOffset = 0; rowOffset < blockHeight; rowOffset += 1) {
    const targetRow = targetStartRow + rowOffset
    for (let column = snapshot.startColumn; column <= snapshot.endColumn; column += 1) {
      const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: column })
      const sourceCell = snapshot.cells.get(`${rowOffset}:${column}`)
      if (sourceCell) worksheet[targetAddress] = cloneTemplateRowCell(sourceCell)
      else delete worksheet[targetAddress]
    }
    const sourceRowInfo = snapshot.rows.get(rowOffset)
    if (sourceRowInfo) {
      worksheet['!rows'] ??= []
      worksheet['!rows'][targetRow] = { ...sourceRowInfo }
    } else if (worksheet['!rows']) {
      delete worksheet['!rows'][targetRow]
    }
  }

  worksheet['!merges'] ??= []
  const targetEndRow = targetStartRow + blockHeight - 1
  worksheet['!merges'] = worksheet['!merges'].filter(
    (merge) => merge.e.r < targetStartRow || merge.s.r > targetEndRow,
  )
  worksheet['!merges'].push(
    ...snapshot.merges.map((merge) => ({
      s: { r: targetStartRow + merge.s.r, c: merge.s.c },
      e: { r: targetStartRow + merge.e.r, c: merge.e.c },
    })),
  )
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
  markerRowCount?: number
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
    copyCfbDirectory(templateCfb, generatedCfb, 'xl/media/')
    copyCfbDirectory(templateCfb, generatedCfb, 'xl/drawings/')
    copyCfbDirectory(templateCfb, generatedCfb, 'xl/printerSettings/')
    mergePreservedPartContentTypes(templateCfb, generatedCfb, [
      'xl/media/',
      'xl/drawings/',
      'xl/printerSettings/',
    ])

    const templateSheetPath = getWorksheetPath(templateCfb, context.sheetIndex)
    const generatedSheetPath = getWorksheetPath(generatedCfb, context.sheetIndex)
    copyCfbFile(templateCfb, generatedCfb, getWorksheetRelationshipsPath(templateSheetPath))
    const templateSheetXml = readCfbText(templateCfb, templateSheetPath)
    const generatedSheetXml = readCfbText(generatedCfb, generatedSheetPath)
    if (templateSheetXml && generatedSheetXml) {
      const templateStylesXml = readCfbText(templateCfb, 'xl/styles.xml')
      const styleByCell = extractCellStyleMap(templateSheetXml)
      fillMissingMergedCellStyles(templateSheetXml, templateStylesXml, styleByCell)
      const styledSheetXml = applyTemplateCellStyles(generatedSheetXml, styleByCell, context)
      const wrappedWorkbook = ensureGeneratedMultilineCellWrapping(
        styledSheetXml,
        templateStylesXml,
        context,
      )
      const patchedSheetXml = preserveWorksheetPresentationElements(
        templateSheetXml,
        applyGeneratedRowAutoHeights(
          wrappedWorkbook.sheetXml,
          wrappedWorkbook.stylesXml,
          context,
        ),
      )
      if (wrappedWorkbook.stylesXml) writeCfbText(generatedCfb, 'xl/styles.xml', wrappedWorkbook.stylesXml)
      writeCfbText(generatedCfb, generatedSheetPath, patchedSheetXml)
      sanitizeGeneratedWorkbookDefinedNames(generatedCfb, patchedSheetXml, context.sheetIndex)
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

function mergePreservedPartContentTypes(
  sourceCfb: CfbContainer,
  targetCfb: CfbContainer,
  preservedDirectories: string[],
) {
  const sourceXml = readCfbText(sourceCfb, '[Content_Types].xml')
  const targetXml = readCfbText(targetCfb, '[Content_Types].xml')
  if (!sourceXml || !targetXml) return

  const targetPaths = new Set(
    targetCfb.FullPaths.map((path) => path.replace(/^Root Entry\//, '').replace(/^\/+/, '')),
  )
  const preservedPaths = Array.from(targetPaths).filter((path) =>
    preservedDirectories.some((directory) => path.startsWith(directory)),
  )
  if (!preservedPaths.length) return

  const requiredExtensions = new Set(
    preservedPaths
      .map((path) => path.split('.').pop()?.toLowerCase())
      .filter((extension): extension is string => Boolean(extension)),
  )
  const additions: string[] = []
  const existingDefaults = new Map(
    (targetXml.match(/<Default\b[^>]*\/?>/g) ?? [])
      .map((tag) => {
        const attrs = parseXmlAttributes(tag)
        return [
          attrs.get('Extension')?.toLowerCase(),
          attrs.get('ContentType'),
        ] as const
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
  )
  const existingOverrides = new Set(
    (targetXml.match(/<Override\b[^>]*\/?>/g) ?? [])
      .map((tag) => parseXmlAttributes(tag).get('PartName')?.replace(/^\/+/, ''))
      .filter((path): path is string => Boolean(path)),
  )

  for (const tag of sourceXml.match(/<Default\b[^>]*\/?>/g) ?? []) {
    const attrs = parseXmlAttributes(tag)
    const extension = attrs.get('Extension')?.toLowerCase()
    const contentType = attrs.get('ContentType')
    if (!extension || !contentType || !requiredExtensions.has(extension)) continue
    const existingContentType = existingDefaults.get(extension)
    if (!existingContentType) {
      additions.push(tag)
      existingDefaults.set(extension, contentType)
      continue
    }
    if (existingContentType === contentType) continue

    for (const partName of preservedPaths.filter(
      (path) => path.split('.').pop()?.toLowerCase() === extension,
    )) {
      if (existingOverrides.has(partName)) continue
      additions.push(
        `<Override PartName="/${escapeXmlAttribute(partName)}" ContentType="${escapeXmlAttribute(contentType)}"/>`,
      )
      existingOverrides.add(partName)
    }
  }

  for (const tag of sourceXml.match(/<Override\b[^>]*\/?>/g) ?? []) {
    const partName = parseXmlAttributes(tag).get('PartName')?.replace(/^\/+/, '')
    if (
      !partName ||
      !targetPaths.has(partName) ||
      !preservedDirectories.some((directory) => partName.startsWith(directory)) ||
      existingOverrides.has(partName)
    ) {
      continue
    }
    additions.push(tag)
    existingOverrides.add(partName)
  }

  if (additions.length) {
    writeCfbText(
      targetCfb,
      '[Content_Types].xml',
      targetXml.replace(/<\/Types>$/, `${additions.join('')}</Types>`),
    )
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

const preservedGeneratedWorkbookNames = new Set([
  '_xlnm.Print_Area',
  '_xlnm.Print_Titles',
])

function sanitizeGeneratedWorkbookDefinedNames(
  generatedCfb: CfbContainer,
  generatedSheetXml: string,
  sheetIndex: number,
) {
  const workbookPath = 'xl/workbook.xml'
  const workbookXml = readCfbText(generatedCfb, workbookPath)
  const definedNamesMatch = workbookXml.match(/<definedNames\b[^>]*>[\s\S]*?<\/definedNames>/)
  if (!workbookXml || !definedNamesMatch) return

  const sheetTags = workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? []
  const sheetName = decodeXmlText(parseXmlAttributes(sheetTags[sheetIndex] ?? '').get('name') ?? '')
  const worksheetDimension = parseWorksheetDimension(generatedSheetXml)
  const keptNames = (definedNamesMatch[0].match(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/g) ?? [])
    .map((definedNameXml) =>
      sanitizeGeneratedWorkbookDefinedName(
        definedNameXml,
        sheetIndex,
        sheetName,
        worksheetDimension,
      ),
    )
    .filter((definedNameXml): definedNameXml is string => Boolean(definedNameXml))

  writeCfbText(
    generatedCfb,
    workbookPath,
    workbookXml.replace(definedNamesMatch[0], keptNames.length
      ? `<definedNames>${keptNames.join('')}</definedNames>`
      : ''),
  )
}

function sanitizeGeneratedWorkbookDefinedName(
  definedNameXml: string,
  generatedSheetIndex: number,
  generatedSheetName: string,
  worksheetDimension: string,
) {
  const openingTag = definedNameXml.match(/^<definedName\b[^>]*>/)?.[0] ?? ''
  const attrs = parseXmlAttributes(openingTag)
  const name = decodeXmlText(attrs.get('name') ?? '')
  const localSheetId = Number(attrs.get('localSheetId'))
  const formula = definedNameXml
    .replace(/^<definedName\b[^>]*>/, '')
    .replace(/<\/definedName>$/, '')

  if (
    !preservedGeneratedWorkbookNames.has(name) ||
    !Number.isInteger(localSheetId) ||
    /#REF!|\[\d+\]/i.test(formula)
  ) {
    return null
  }

  if (
    name !== '_xlnm.Print_Area' ||
    localSheetId !== generatedSheetIndex ||
    !generatedSheetName ||
    !worksheetDimension
  ) {
    return definedNameXml
  }

  const updatedFormula = updatePrintAreaFormula(
    decodeXmlText(formula),
    generatedSheetName,
    worksheetDimension,
  )
  return `${openingTag}${escapeXmlText(updatedFormula)}</definedName>`
}

function parseWorksheetDimension(sheetXml: string) {
  const dimensionTag = sheetXml.match(/<dimension\b[^>]*\/?>/)?.[0] ?? ''
  return parseXmlAttributes(dimensionTag).get('ref') ?? ''
}

function updatePrintAreaFormula(
  formula: string,
  sheetName: string,
  worksheetDimension: string,
) {
  const dimensionRange = worksheetDimension.match(/^([A-Z]+\d+):([A-Z]+\d+)$/i)
  const existingRange = formula.match(/!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i)
  if (!dimensionRange || !existingRange) return formula

  const dimensionEnd = decodeCellReference(dimensionRange[2])
  if (!dimensionEnd) return formula

  const startColumn = existingRange[1].toUpperCase()
  const startRow = Number(existingRange[2])
  const endColumn = existingRange[3].toUpperCase()
  const endRow = Math.max(Number(existingRange[4]), dimensionEnd.row)
  const quotedSheetName = `'${sheetName.replace(/'/g, "''")}'`
  return `${quotedSheetName}!$${startColumn}$${startRow}:$${endColumn}$${endRow}`
}

const worksheetPresentationElementOrder = [
  'printOptions',
  'pageMargins',
  'pageSetup',
  'headerFooter',
  'rowBreaks',
  'colBreaks',
  'customProperties',
  'cellWatches',
  'ignoredErrors',
  'smartTags',
  'drawing',
  'legacyDrawing',
  'legacyDrawingHF',
  'picture',
  'oleObjects',
  'controls',
  'webPublishItems',
  'tableParts',
  'extLst',
] as const

function preserveWorksheetPresentationElements(
  templateSheetXml: string,
  generatedSheetXml: string,
) {
  const templateElements = [
    ...extractWorksheetElements(templateSheetXml, [
      'printOptions',
      'pageMargins',
      'pageSetup',
      'headerFooter',
      'drawing',
      'legacyDrawing',
      'legacyDrawingHF',
    ]),
  ]
  if (!templateElements.length) return generatedSheetXml

  return templateElements.reduce((sheetXml, element) => {
    const existingPattern = createWorksheetElementPattern(element.name)
    if (existingPattern.test(sheetXml)) {
      return sheetXml.replace(existingPattern, element.xml)
    }
    return insertWorksheetElementInSchemaOrder(sheetXml, element.name, element.xml)
  }, generatedSheetXml)
}

function extractWorksheetElements(sheetXml: string, names: string[]) {
  return names.flatMap((name) => {
    const match = sheetXml.match(createWorksheetElementPattern(name))
    return match ? [{ name, xml: match[0] }] : []
  })
}

function createWorksheetElementPattern(name: string) {
  return new RegExp(`<(?:${name})\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/(?:${name})>)`)
}

function insertWorksheetElementInSchemaOrder(
  sheetXml: string,
  elementName: string,
  elementXml: string,
) {
  const elementIndex = worksheetPresentationElementOrder.indexOf(
    elementName as (typeof worksheetPresentationElementOrder)[number],
  )
  const laterElements =
    elementIndex >= 0 ? worksheetPresentationElementOrder.slice(elementIndex + 1) : []
  const insertionPattern = laterElements.length
    ? new RegExp(`<(?:${laterElements.join('|')})\\b`)
    : /<\/worksheet>$/
  const match = insertionPattern.exec(sheetXml)
  const insertionIndex = match?.index ?? sheetXml.lastIndexOf('</worksheet>')
  if (insertionIndex < 0) return sheetXml
  return `${sheetXml.slice(0, insertionIndex)}${elementXml}${sheetXml.slice(insertionIndex)}`
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

function fillMissingMergedCellStyles(
  sheetXml: string,
  stylesXml: string,
  styleByCell: Map<string, string>,
) {
  const cellFormats = extractXmlCollection(stylesXml, 'cellXfs', 'xf')
  const borders = extractXmlCollection(stylesXml, 'borders', 'border')
  for (const tag of sheetXml.match(/<mergeCell\b[^>]*\/?>/g) ?? []) {
    const range = parseXmlAttributes(tag).get('ref')
    const [startRef, endRef] = range?.split(':') ?? []
    const start = startRef ? decodeCellReference(startRef) : null
    const end = endRef ? decodeCellReference(endRef) : null
    if (!start || !end) continue
    const anchorStyle = styleByCell.get(`${start.row}:${start.column}`)
    if (anchorStyle === undefined || !cellStyleHasVisibleBorder(anchorStyle, cellFormats, borders)) continue

    for (let row = start.row; row <= end.row; row += 1) {
      for (let column = start.column; column <= end.column; column += 1) {
        const key = `${row}:${column}`
        const currentStyle = styleByCell.get(key)
        if (
          currentStyle === undefined ||
          !cellStyleHasVisibleBorder(currentStyle, cellFormats, borders)
        ) {
          styleByCell.set(key, anchorStyle)
        }
      }
    }
  }
}

function cellStyleHasVisibleBorder(styleId: string, cellFormats: string[], borders: string[]) {
  const cellFormat = cellFormats[Number(styleId)] ?? ''
  const openingTag = cellFormat.match(/^<xf\b[^>]*\/?>/)?.[0]
  const borderId = Number(openingTag ? parseXmlAttributes(openingTag).get('borderId') ?? 0 : 0)
  const borderXml = Number.isFinite(borderId) ? borders[borderId] ?? '' : ''
  return /<(?:left|right|top|bottom)\b[^>]*\bstyle="[^"]+"/.test(borderXml)
}

function applyTemplateCellStyles(
  sheetXml: string,
  styleByCell: Map<string, string>,
  { markerRow, markerRowCount = 1, recordCount, sheetIndex }: WorkbookXmlPreservationContext,
) {
  const outputRecordCount = Math.max(recordCount, 1)
  const extraRows = Math.max(outputRecordCount - 1, 0) * markerRowCount
  const generatedStartRow = markerRow + 1
  const generatedEndRow = generatedStartRow + outputRecordCount * markerRowCount - 1

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
          ? generatedStartRow + ((decoded.row - generatedStartRow) % markerRowCount)
          : decoded.row - extraRows
    const styleId = styleByCell.get(`${sourceRow}:${decoded.column}`)
    return styleId === undefined ? removeXmlAttribute(tag, 's') : setXmlAttribute(tag, 's', styleId)
  })

  return ensureTemplateStyledEmptyCells(styledSheetXml, styleByCell, {
    markerRow,
    markerRowCount,
    recordCount,
    sheetIndex,
  })
}

function ensureTemplateStyledEmptyCells(
  sheetXml: string,
  styleByCell: Map<string, string>,
  { markerRow, markerRowCount = 1, recordCount }: WorkbookXmlPreservationContext,
) {
  const outputRecordCount = Math.max(recordCount, 1)
  const extraRows = Math.max(outputRecordCount - 1, 0) * markerRowCount
  const generatedStartRow = markerRow + 1
  const generatedSourceEndRow = generatedStartRow + markerRowCount - 1
  const stylesByOutputRow = new Map<number, Map<number, string>>()

  for (const [key, styleId] of styleByCell.entries()) {
    const [sourceRow, column] = key.split(':').map(Number)
    if (!Number.isFinite(sourceRow) || !Number.isFinite(column)) continue
    const outputRows =
      sourceRow >= generatedStartRow && sourceRow <= generatedSourceEndRow
        ? Array.from(
            { length: outputRecordCount },
            (_, index) => sourceRow + index * markerRowCount,
          )
        : [sourceRow > generatedSourceEndRow ? sourceRow + extraRows : sourceRow]
    for (const outputRow of outputRows) {
      const rowStyles = stylesByOutputRow.get(outputRow) ?? new Map<number, string>()
      rowStyles.set(column, styleId)
      stylesByOutputRow.set(outputRow, rowStyles)
    }
  }

  if (!stylesByOutputRow.size) return sheetXml

  return sheetXml.replace(
    /(<sheetData\b[^>]*>)([\s\S]*?)(<\/sheetData>)/,
    (_sheetData, openingTag: string, innerXml: string, closingTag: string) => {
      const rows = new Map<number, string>()
      for (const rowXml of innerXml.match(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g) ?? []) {
        const rowOpeningTag = rowXml.match(/^<row\b[^>]*\/?>/)?.[0]
        const rowNumber = Number(rowOpeningTag ? parseXmlAttributes(rowOpeningTag).get('r') : 0)
        if (!Number.isFinite(rowNumber) || rowNumber <= 0) continue
        const styleByColumn = stylesByOutputRow.get(rowNumber)
        rows.set(
          rowNumber,
          styleByColumn?.size
            ? applyStylesToWorksheetRow(rowXml, rowNumber, styleByColumn)
            : rowXml,
        )
      }

      for (const [rowNumber, styleByColumn] of stylesByOutputRow.entries()) {
        if (rows.has(rowNumber)) continue
        rows.set(
          rowNumber,
          applyStylesToWorksheetRow(`<row r="${rowNumber}"/>`, rowNumber, styleByColumn),
        )
      }

      return `${openingTag}${Array.from(rows.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, rowXml]) => rowXml)
        .join('')}${closingTag}`
    },
  )
}

function applyStylesToWorksheetRow(
  rowXml: string,
  rowNumber: number,
  styleByColumn: Map<number, string>,
) {
  const rowOpeningTag = rowXml.match(/^<row\b[^>]*\/?>/)?.[0] ?? `<row r="${rowNumber}"/>`
  const cells = new Map<number, string>()

  for (const cellXml of rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
    const cellOpeningTag = cellXml.match(/^<c\b[^>]*\/?>/)?.[0]
    const cellRef = cellOpeningTag ? parseXmlAttributes(cellOpeningTag).get('r') : undefined
    const decoded = cellRef ? decodeCellReference(cellRef) : null
    if (!cellOpeningTag || !decoded) continue
    const styleId = styleByColumn.get(decoded.column)
    cells.set(
      decoded.column,
      styleId === undefined
        ? cellXml
        : cellXml.replace(cellOpeningTag, setXmlAttribute(cellOpeningTag, 's', styleId)),
    )
  }

  for (const [column, styleId] of styleByColumn.entries()) {
    if (!cells.has(column)) {
      cells.set(
        column,
        `<c r="${encodeCellReference(rowNumber, column)}" s="${escapeXmlAttribute(styleId)}"/>`,
      )
    }
  }

  const normalizedOpeningTag = rowOpeningTag.replace(/\/>$/, '>')
  const innerXml = /\/>$/.test(rowXml)
    ? ''
    : rowXml
        .replace(/^<row\b[^>]*>/, '')
        .replace(/<\/row>$/, '')
  const nonCellXml = innerXml.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g, '')
  return `${normalizedOpeningTag}${Array.from(cells.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, cellXml]) => cellXml)
    .join('')}${nonCellXml}</row>`
}

function ensureGeneratedMultilineCellWrapping(
  sheetXml: string,
  stylesXml: string,
  { markerRow, markerRowCount = 1, recordCount }: WorkbookXmlPreservationContext,
) {
  const generatedStartRow = markerRow + 1
  const generatedEndRow =
    generatedStartRow + Math.max(recordCount, 1) * markerRowCount - 1
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
  { markerRow, markerRowCount = 1, recordCount }: WorkbookXmlPreservationContext,
) {
  const generatedStartRow = markerRow + 1
  const generatedEndRow =
    generatedStartRow + Math.max(recordCount, 1) * markerRowCount - 1
  const columnWidths = extractWorksheetColumnWidths(sheetXml)
  const mergeColumnSpans = extractWorksheetMergeColumnSpans(sheetXml)
  const cellFormats = extractXmlCollection(stylesXml, 'cellXfs', 'xf')
  const fonts = extractXmlCollection(stylesXml, 'fonts', 'font')

  return sheetXml.replace(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g, (rowXml) => {
    const openingTag = rowXml.match(/^<row\b[^>]*>/)?.[0]
    if (!openingTag) return rowXml
    const rowNumber = Number(parseXmlAttributes(openingTag).get('r'))
    if (!Number.isFinite(rowNumber) || rowNumber < generatedStartRow || rowNumber > generatedEndRow) return rowXml

    let requiredHeight = 0
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
      const fontSize = getCellFormatFontSize(cellFormats[styleId] ?? '', fonts)
      const lineHeight = Math.max(fontSize * 1.25, 15)
      requiredHeight = Math.max(requiredHeight, lineCount * lineHeight + 3)
    }

    const clearedOpeningTag = removeXmlAttribute(removeXmlAttribute(openingTag, 'ht'), 'customHeight')
    if (requiredHeight <= 18) return rowXml.replace(openingTag, clearedOpeningTag)
    const existingHeight = Number(parseXmlAttributes(openingTag).get('ht') ?? 0)
    const calculatedHeight = Math.min(Math.max(requiredHeight, existingHeight, 18), 409)
    const fittedOpeningTag = setXmlAttribute(
      setXmlAttribute(clearedOpeningTag, 'ht', String(calculatedHeight)),
      'customHeight',
      '1',
    )
    return rowXml.replace(openingTag, fittedOpeningTag)
  })
}

function getCellFormatFontSize(cellFormat: string, fonts: string[]) {
  const openingTag = cellFormat.match(/^<xf\b[^>]*\/?>/)?.[0]
  const fontId = Number(openingTag ? parseXmlAttributes(openingTag).get('fontId') ?? 0 : 0)
  const fontXml = Number.isFinite(fontId) ? fonts[fontId] ?? '' : ''
  const sizeTag = fontXml.match(/<sz\b[^>]*\/?>/)?.[0]
  const size = Number(sizeTag ? parseXmlAttributes(sizeTag).get('val') : 0)
  return Number.isFinite(size) && size > 0 ? size : 11
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

function escapeXmlText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

function notifyDocumentTemplateStorageChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(DOCUMENT_TEMPLATE_STORAGE_EVENT))
}

function fromRemoteDocumentTemplate(
  remote: Awaited<ReturnType<typeof getRemoteDocumentTemplate>> & { fileDataBase64: string },
): StoredDocumentTemplate {
  return {
    ...remote,
    constructorConfig: remote.constructorConfig
      ? normalizeDocumentTemplateConstructorConfig(remote.constructorConfig)
      : undefined,
    fileData: base64ToArrayBuffer(remote.fileDataBase64),
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

function base64ToArrayBuffer(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}
