import * as XLSX from 'xlsx'
import { FIELD_BY_KEY, type WeldField, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { createZip } from '@/lib/weld-export-zip'
import { escapeXml, getExportColumnWidth, normalizeSheetName } from '@/lib/weld-export-utils'
import type { ActiveReport } from '@/lib/home-state'
import { getReportImportFieldKeys } from '@/lib/report-field-state'
import { VISIBLE_FIELDS } from '@/lib/weld-visible-field-layout'
import type { WeldRow } from '@/lib/dispatcher-types'

export type ImportTemplateCellKind = 'free' | 'checked' | 'ignored'
export type ReportImportMode = 'newRecords' | 'massFill' | 'replaceData'

export const MASS_FILL_ROW_ID_HEADER = 'ID записи'
export const REPLACE_DELETE_ROW_HEADER = 'Удалить строку'

const WELD_IMPORT_IGNORED_FIELD_KEYS = new Set<string>([
  'status',
  'finalStatus',
  'revisionActuality',
  'createdAt',
  'pstoCreatedAt',
  'lnkCreatedAt',
  'vikRequest',
  'rkRequest',
  'uzkRequest',
  'pvkRequest',
  'pstoRequest',
  'tvmtRequest',
  'rfaRequest',
  'stlsRequest',
  'mkkRequest',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
  'vikResult',
  'rkResult',
  'uzkResult',
  'pvkResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'vikConclusionDate',
  'vikConclusion',
  'rkConclusionDate',
  'rkConclusion',
  'uzkConclusionDate',
  'uzkConclusion',
  'pvkConclusionDate',
  'pvkConclusion',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'rfaConclusionDate',
  'rfaConclusion',
  'stlsConclusionDate',
  'stlsConclusion',
  'mkkConclusionDate',
  'mkkConclusion',
  'lnkDefectDescription',
  'lnkNote',
])

const WELD_IMPORT_CHECKED_FIELD_KEYS = new Set<string>([
  'joint',
  'weldDate',
  'weldingMethod',
  'connectionType',
  'd1',
  'd2',
  'stamp1K',
  'stamp1Z',
  'stamp1O',
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2K',
  'stamp2Z',
  'stamp2O',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
  'hasVik',
  'hasRk',
  'hasUzk',
  'hasPvk',
  'pstoRequired',
  'hasTvmt',
  'hasRfa',
  'hasStls',
  'hasMkk',
])

const PREVIEW_FIELD_KEYS = [
  'line',
  'joint',
  'weldDate',
  'weldingMethod',
  'd1',
  'd2',
  'wdi',
  'stamp1K',
  'stamp1Z',
  'stamp1O',
  'hasVik',
  'hasRk',
] as const

export function getReportImportTemplateFields(activeReport: ActiveReport) {
  if (activeReport === 'heatTreatment' || activeReport === 'lnk') {
    const options = getReportImportFieldKeys(activeReport)
    if (!options) return VISIBLE_FIELDS
    const allowedKeys = new Set([...options.matchFieldKeys, ...options.editableFieldKeys])
    return VISIBLE_FIELDS.filter((field) => allowedKeys.has(field.key))
  }
  return VISIBLE_FIELDS
}

export function getReportImportPreviewFields(activeReport: ActiveReport) {
  const fields = getReportImportTemplateFields(activeReport)
  if (activeReport === 'weldingJournal') {
    const priority = PREVIEW_FIELD_KEYS.map((key) => FIELD_BY_KEY.get(key)).filter(Boolean) as WeldField[]
    return priority.filter((field) => fields.some((candidate) => candidate.key === field.key))
  }
  return fields.slice(0, 12)
}

export function getReportImportCellKind(activeReport: ActiveReport, fieldKey: string): ImportTemplateCellKind {
  if (activeReport === 'weldingJournal') {
    if (WELD_IMPORT_IGNORED_FIELD_KEYS.has(fieldKey)) return 'ignored'
    if (WELD_IMPORT_CHECKED_FIELD_KEYS.has(fieldKey)) return 'checked'
    return 'free'
  }

  const options = getReportImportFieldKeys(activeReport)
  if (!options) return 'free'
  if (options.matchFieldKeys.has(fieldKey as WeldFieldKey)) return 'checked'
  return 'free'
}

export function getReportImportIgnoredFieldKeys(activeReport: ActiveReport) {
  if (activeReport === 'weldingJournal') return WELD_IMPORT_IGNORED_FIELD_KEYS
  return new Set<string>()
}

export function getReportImportCheckedFieldKeys(activeReport: ActiveReport) {
  if (activeReport === 'weldingJournal') return WELD_IMPORT_CHECKED_FIELD_KEYS
  const options = getReportImportFieldKeys(activeReport)
  return options ? options.matchFieldKeys : new Set<string>()
}

export function stripIgnoredImportFields(record: WeldInput, activeReport: ActiveReport) {
  const ignoredKeys = getReportImportIgnoredFieldKeys(activeReport)
  if (ignoredKeys.size === 0) return record
  const nextRecord = { ...record }
  for (const key of ignoredKeys) {
    delete nextRecord[key as WeldFieldKey]
  }
  return nextRecord
}

export function buildImportTemplateXlsxBytes(activeReport: ActiveReport) {
  const fields = getReportImportTemplateFields(activeReport)
  const sheetName = normalizeSheetName(getReportImportTemplateSheetName(activeReport))
  const rowCount = 60
  const rows = [
    fields.map((field) => field.label),
    ...Array.from({ length: rowCount }, () => fields.map(() => '')),
  ]

  return createZip([
    { path: '[Content_Types].xml', content: buildContentTypesXml() },
    { path: '_rels/.rels', content: buildRootRelsXml() },
    { path: 'xl/workbook.xml', content: buildWorkbookXml(sheetName) },
    { path: 'xl/_rels/workbook.xml.rels', content: buildWorkbookRelsXml() },
    { path: 'xl/styles.xml', content: buildTemplateStylesXml() },
    { path: 'xl/worksheets/sheet1.xml', content: buildTemplateWorksheetXml(rows, fields, activeReport) },
  ])
}

export function buildMassFillTemplateXlsxBytes(activeReport: ActiveReport, records: readonly WeldRow[]) {
  return buildExistingRowsTemplateXlsxBytes(activeReport, records, 'massFill')
}

export function buildReplaceDataTemplateXlsxBytes(activeReport: ActiveReport, records: readonly WeldRow[]) {
  return buildExistingRowsTemplateXlsxBytes(activeReport, records, 'replaceData')
}

function buildExistingRowsTemplateXlsxBytes(activeReport: ActiveReport, records: readonly WeldRow[], mode: Extract<ReportImportMode, 'massFill' | 'replaceData'>) {
  const fields = getReportImportTemplateFields(activeReport)
  const sheetName = normalizeSheetName(getExistingRowsTemplateSheetName(activeReport, mode))
  const serviceFields =
    mode === 'replaceData'
      ? [
          { key: '__rowId', label: MASS_FILL_ROW_ID_HEADER },
          { key: '__deleteRow', label: REPLACE_DELETE_ROW_HEADER },
        ]
      : [{ key: '__rowId', label: MASS_FILL_ROW_ID_HEADER }]
  const templateFields = [...serviceFields, ...fields] as const
  const rows = [
    templateFields.map((field) => field.label),
    ...records.map((record) => [
      record.id,
      ...(mode === 'replaceData' ? [''] : []),
      ...fields.map((field) => record[field.key as keyof WeldRow] ?? ''),
    ]),
  ]

  return createZip([
    { path: '[Content_Types].xml', content: buildContentTypesXml() },
    { path: '_rels/.rels', content: buildRootRelsXml() },
    { path: 'xl/workbook.xml', content: buildWorkbookXml(sheetName) },
    { path: 'xl/_rels/workbook.xml.rels', content: buildWorkbookRelsXml() },
    { path: 'xl/styles.xml', content: buildTemplateStylesXml() },
    { path: 'xl/worksheets/sheet1.xml', content: buildExistingRowsWorksheetXml(rows, fields, activeReport, records, mode) },
  ])
}

export function getReportImportTemplateFilename(activeReport: ActiveReport) {
  if (activeReport === 'heatTreatment') return 'Шаблон импорта ПСТО.xlsx'
  if (activeReport === 'lnk') return 'Шаблон импорта ЛНК.xlsx'
  return 'Шаблон импорта сварочного журнала.xlsx'
}

export function getMassFillTemplateFilename(activeReport: ActiveReport) {
  if (activeReport === 'heatTreatment') return 'Шаблон массового заполнения ПСТО.xlsx'
  if (activeReport === 'lnk') return 'Шаблон массового заполнения ЛНК.xlsx'
  return 'Шаблон массового заполнения сварочного журнала.xlsx'
}

export function getReplaceDataTemplateFilename(activeReport: ActiveReport) {
  if (activeReport === 'heatTreatment') return 'Шаблон замены данных ПСТО.xlsx'
  if (activeReport === 'lnk') return 'Шаблон замены данных ЛНК.xlsx'
  return 'Шаблон замены данных сварочного журнала.xlsx'
}

function getReportImportTemplateSheetName(activeReport: ActiveReport) {
  if (activeReport === 'heatTreatment') return 'Импорт ПСТО'
  if (activeReport === 'lnk') return 'Импорт ЛНК'
  return 'Импорт сварочного журнала'
}

function getMassFillTemplateSheetName(activeReport: ActiveReport) {
  return getExistingRowsTemplateSheetName(activeReport, 'massFill')
}

function getExistingRowsTemplateSheetName(activeReport: ActiveReport, mode: Extract<ReportImportMode, 'massFill' | 'replaceData'>) {
  if (mode === 'replaceData') {
    if (activeReport === 'heatTreatment') return 'Замена ПСТО'
    if (activeReport === 'lnk') return 'Замена ЛНК'
    return 'Замена данных'
  }
  if (activeReport === 'heatTreatment') return 'Заполнение ПСТО'
  if (activeReport === 'lnk') return 'Заполнение ЛНК'
  return 'Заполнение журнала'
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
 <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
}

function buildWorkbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
}

function buildTemplateStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <fonts count="2">
  <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
 </fonts>
 <fills count="5">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill>
 </fills>
 <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
 <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
 <cellXfs count="6">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
 </cellXfs>
 <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
 <dxfs count="0"/>
 <tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="TableStyleMedium4"/>
</styleSheet>`
}

function buildTemplateWorksheetXml(rows: unknown[][], fields: readonly WeldField[], activeReport: ActiveReport) {
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
          const styleId = rowIndex === 0 ? getTemplateHeaderStyleId(activeReport, field?.key) : getTemplateStyleId(activeReport, field?.key)
          const ref = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })
          const text = String(value ?? '')
          if (!text) return `<c r="${ref}" s="${styleId}"/>`
          return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t>${escapeXml(text)}</t></is></c>`
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

function buildExistingRowsWorksheetXml(
  rows: unknown[][],
  fields: readonly WeldField[],
  activeReport: ActiveReport,
  records: readonly WeldRow[],
  mode: Extract<ReportImportMode, 'massFill' | 'replaceData'>,
) {
  const serviceColumnCount = mode === 'replaceData' ? 2 : 1
  const allColumns =
    mode === 'replaceData'
      ? [
          { key: '__rowId', label: MASS_FILL_ROW_ID_HEADER },
          { key: '__deleteRow', label: REPLACE_DELETE_ROW_HEADER },
          ...fields,
        ]
      : ([{ key: '__rowId', label: MASS_FILL_ROW_ID_HEADER }, ...fields] as const)
  const cols = allColumns
    .map((field, index) => {
      const column = index + 1
      const width = field.key === '__rowId' ? 10 : field.key === '__deleteRow' ? 16 : getExportColumnWidth(field as WeldField)
      return `<col min="${column}" max="${column}" width="${width}" customWidth="1"/>`
    })
    .join('')
  const rowXml = rows
    .map((row, rowIndex) => {
      const record = rowIndex > 0 ? records[rowIndex - 1] : null
      const cells = row
        .map((value, columnIndex) => {
          const isDeleteColumn = mode === 'replaceData' && columnIndex === 1
          const field = columnIndex < serviceColumnCount ? null : fields[columnIndex - serviceColumnCount]
          const styleId =
            rowIndex === 0
              ? isDeleteColumn
                ? 5
                : getMassFillHeaderStyleId(activeReport, field?.key)
              : isDeleteColumn
                ? 3
              : getExistingRowsBodyStyleId(activeReport, field ?? undefined, record, mode)
          const ref = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })
          const text = String(value ?? '')
          if (!text) return `<c r="${ref}" s="${styleId}"/>`
          if (typeof value === 'number') return `<c r="${ref}" s="${styleId}"><v>${value}</v></c>`
          return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t>${escapeXml(text)}</t></is></c>`
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

function getTemplateStyleId(activeReport: ActiveReport, fieldKey?: string) {
  if (!fieldKey) return 0
  const kind = getReportImportCellKind(activeReport, fieldKey)
  if (kind === 'ignored') return 2
  if (kind === 'checked') return 3
  return 0
}

function getTemplateHeaderStyleId(activeReport: ActiveReport, fieldKey?: string) {
  if (!fieldKey) return 1
  const kind = getReportImportCellKind(activeReport, fieldKey)
  if (kind === 'ignored') return 4
  if (kind === 'checked') return 5
  return 1
}

function getMassFillHeaderStyleId(activeReport: ActiveReport, fieldKey?: string) {
  if (!fieldKey) return 4
  return getTemplateHeaderStyleId(activeReport, fieldKey)
}

function getExistingRowsBodyStyleId(
  activeReport: ActiveReport,
  field?: WeldField,
  record?: WeldRow | null,
  mode: Extract<ReportImportMode, 'massFill' | 'replaceData'> = 'massFill',
) {
  if (!field || !record) return 2
  if (mode === 'massFill' && isMassFillFieldLocked(activeReport, field, record)) return 2
  if (mode === 'replaceData' && isSystemImportField(activeReport, field)) return 2
  return getTemplateStyleId(activeReport, field.key)
}

export function isMassFillFieldLocked(activeReport: ActiveReport, field: WeldField, record: WeldInput) {
  if (isSystemImportField(activeReport, field)) return true
  return hasMassFillValue(record[field.key as keyof WeldInput])
}

export function isSystemImportField(activeReport: ActiveReport, field: WeldField) {
  return getReportImportCellKind(activeReport, field.key) === 'ignored'
}

function hasMassFillValue(value: unknown) {
  if (value === null || value === undefined) return false
  return String(value).trim() !== ''
}
