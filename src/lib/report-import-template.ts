import * as XLSX from 'xlsx'
import { FIELD_BY_KEY, type WeldField, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { createZip } from '@/lib/weld-export-zip'
import { escapeXml, getExportColumnWidth, normalizeSheetName } from '@/lib/weld-export-utils'
import type { ActiveReport } from '@/lib/home-state'
import { getReportImportFieldKeys } from '@/lib/report-field-state'
import { VISIBLE_FIELDS } from '@/lib/weld-visible-field-layout'

export type ImportTemplateCellKind = 'free' | 'checked' | 'ignored'

const WELD_IMPORT_IGNORED_FIELD_KEYS = new Set<string>([
  'status',
  'finalStatus',
  'revisionActuality',
  'createdAt',
  'pstoCreatedAt',
  'lnkCreatedAt',
  'vikRequest',
  'rkRequest',
  'pvkRequest',
  'uzkRequest',
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
  'pvkResult',
  'uzkResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'vikConclusionDate',
  'vikConclusion',
  'rkConclusionDate',
  'rkConclusion',
  'pvkConclusionDate',
  'pvkConclusion',
  'uzkConclusionDate',
  'uzkConclusion',
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
  'boq',
  'ks3',
  'pstoBoq',
  'pstoKs3',
  'vikBoq',
  'vikKs3',
  'rkBoq',
  'rkKs3',
  'pvkBoq',
  'pvkKs3',
  'uzkBoq',
  'uzkKs3',
  'tvmtBoq',
  'tvmtKs3',
  'rfaBoq',
  'rfaKs3',
  'stlsBoq',
  'stlsKs3',
  'mkkBoq',
  'mkkKs3',
])

const WELD_IMPORT_CHECKED_FIELD_KEYS = new Set<string>([
  'joint',
  'weldDate',
  'weldingMethod',
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
  'hasPvk',
  'hasUzk',
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
  if (options.matchFieldKeys.has(fieldKey)) return 'checked'
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

export function getReportImportTemplateFilename(activeReport: ActiveReport) {
  if (activeReport === 'heatTreatment') return 'Шаблон импорта ПСТО.xlsx'
  if (activeReport === 'lnk') return 'Шаблон импорта ЛНК.xlsx'
  return 'Шаблон импорта сварочного журнала.xlsx'
}

function getReportImportTemplateSheetName(activeReport: ActiveReport) {
  if (activeReport === 'heatTreatment') return 'Импорт ПСТО'
  if (activeReport === 'lnk') return 'Импорт ЛНК'
  return 'Импорт сварочного журнала'
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
