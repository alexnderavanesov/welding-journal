import { type WeldInput } from '@/lib/weld-fields'
import { type TemplateStampNameFieldKey } from '@/lib/welder-stamp-names'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import {
  isWeldingJournalDocumentSplitMode,
  type WeldingJournalDocumentSplitMode,
} from '@/lib/welding-journal-document-splitting'
import type { DocumentTemplateNameConfig } from '@/lib/document-template-name'
import { LAYERED_CONTROL_DOCUMENT_TYPES, type GeneratedDocumentType } from '@/lib/generated-document-types'
import { getLayeredControlDocumentProfile } from '@/lib/layered-control-documents'
import {
  CONFIGURABLE_SYSTEM_DOCUMENT_TEMPLATE_PROFILES,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import { type SystemDocumentTemplateContext } from '@/lib/system-document-types'

import { decodeCellReference } from '@/lib/document-template-xlsx'

export type {
  DocumentTemplateNameConfig,
  DocumentTemplateNameFieldKey,
  DocumentTemplateNamePart,
} from '@/lib/document-template-name'

export {
  buildDocumentTemplateName,
  createDefaultDocumentTemplateNameConfig,
} from '@/lib/document-template-name'

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
  ...CONFIGURABLE_SYSTEM_DOCUMENT_TEMPLATE_PROFILES,
  ...LAYERED_CONTROL_DOCUMENT_TYPES.map((id) => {
    const profile = getLayeredControlDocumentProfile(id)
    return {
      id,
      label: profile.templateLabel,
      description: profile.templateDescription,
    }
  }),
] as const

export type DocumentTemplateId = GeneratedDocumentType | SystemDocumentTemplateId

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
  | '__groupIndex'
  | '__welderName'
  | `__welderName:${TemplateStampNameFieldKey}`
  | '__systemDocumentTitle'
  | '__systemDocumentDate'
  | '__systemDocumentNumber'
  | '__systemDocumentMethods'
  | '__systemDocumentResult'
  | '__rkExposureCoordinate'
  | '__rkExposureDescription'

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
  const isInsideRepeatBlock = (binding: DocumentTemplateCellBinding) => {
    if (!repeatRow || !repeatRowEnd) return false
    const bindingRow = decodeCellReference(binding.cell)?.row ?? 0
    return bindingRow >= repeatRow && bindingRow <= repeatRowEnd
  }
  const normalizeBindingForRepeatMode = (binding: DocumentTemplateCellBinding) => {
    const normalizedFieldBinding: DocumentTemplateCellBinding = {
      ...binding,
      field: migrateLegacyOfficialityField(binding.field),
      parts: binding.parts?.map((part) => ({
        ...part,
        field: migrateLegacyOfficialityField(part.field),
        compareField: migrateLegacyOfficialityField(part.compareField),
      })),
    }
    const insideRepeatBlock = isInsideRepeatBlock(normalizedFieldBinding)
    if (repeatMode === 'groups' && insideRepeatBlock) {
      return convertDocumentTemplateBindingToGroupSummary(normalizedFieldBinding)
    }
    if (
      collapsedJointGrouping &&
      insideRepeatBlock &&
      normalizedFieldBinding.mode === 'summary' &&
      normalizedFieldBinding.scope === 'group'
    ) {
      return convertDocumentTemplateBindingToJointRow(normalizedFieldBinding)
    }
    return { ...normalizedFieldBinding, scope: undefined }
  }
  return {
    ...config,
    repeatRow,
    repeatRowEnd,
    repeatMode,
    repeatGroupBy: repeatMode === 'groups' ? migrateLegacyOfficialityField(config.repeatGroupBy) : undefined,
    nameConfig: config.nameConfig
      ? {
          parts: config.nameConfig.parts.map((part) => ({
            ...part,
            field: migrateLegacyOfficialityField(part.field),
          })),
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
        return [normalizeBindingForRepeatMode(bindingWithoutSource as DocumentTemplateCellBinding)]
      }

      const normalizedBinding: DocumentTemplateCellBinding = {
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
      }
      return [normalizeBindingForRepeatMode(normalizedBinding)]
    }),
  }
}

function migrateLegacyOfficialityField<T>(field: T): T {
  return (field === 'status' ? 'officiality' : field) as T
}

export function convertDocumentTemplateBindingToGroupSummary(
  binding: DocumentTemplateCellBinding,
): DocumentTemplateCellBinding {
  const parts = getConstructorBindingParts(binding).map((part) => ({
    ...part,
    field: part.field === '__index' ? '__groupIndex' as const : part.field,
    compareField: part.compareField === '__index' ? '__groupIndex' as const : part.compareField,
  }))
  return {
    ...binding,
    mode: 'summary',
    field: undefined,
    parts,
    uniqueParts: undefined,
    uniqueValues: binding.mode === 'summary' ? binding.uniqueValues ?? true : true,
    scope: 'group',
  }
}

export function convertDocumentTemplateBindingToJointRow(
  binding: DocumentTemplateCellBinding,
): DocumentTemplateCellBinding {
  const parts = getConstructorBindingParts(binding).map((part) => ({
    ...part,
    field: part.field === '__groupIndex' ? '__index' as const : part.field,
    compareField: part.compareField === '__groupIndex' ? '__index' as const : part.compareField,
  }))
  return {
    ...binding,
    mode: 'row',
    field: undefined,
    parts,
    uniqueParts: binding.uniqueParts ?? binding.uniqueValues,
    uniqueValues: undefined,
    scope: undefined,
  }
}

export type StoredDocumentTemplate = TemplateUploadInfo & {
  id: DocumentTemplateId
  version?: string
  fileData: ArrayBuffer
  options?: DocumentTemplateOptions
  constructorConfig?: DocumentTemplateConstructorConfig
}

export type DocumentTemplateReplacementStatus = 'compatible' | 'adjusted' | 'incompatible'

export type DocumentTemplateReplacementIssue = {
  code:
    | 'sheet-missing'
    | 'cell-missing'
    | 'cell-merge-changed'
    | 'repeat-block-missing'
    | 'repeat-block-merge-changed'
    | 'structure-ambiguous'
  message: string
}

export type DocumentTemplateReplacementMapping = {
  sheetName?: string
  rowOffset?: number
  columnOffset?: number
}

export type DocumentTemplateReplacementAnalysis = {
  status: DocumentTemplateReplacementStatus
  sourceSheetName?: string
  targetSheetName?: string
  candidateSheetNames: string[]
  rowOffset: number
  columnOffset: number
  bindingCount: number
  retainedBindingCount: number
  constructorConfig?: DocumentTemplateConstructorConfig
  issues: DocumentTemplateReplacementIssue[]
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

export type TemplateMarkerCell = {
  address: string
  row: number
  column: number
  source: string
  fields: string[]
}

export type TemplateSystemField =
  | '__index'
  | '__groupIndex'
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

export function getConstructorBindingParts(binding: DocumentTemplateCellBinding) {
  if (binding.parts?.length) return binding.parts
  return (binding.mode === 'row' || binding.mode === 'summary') && binding.field
    ? [{ field: binding.field }]
    : []
}

export function getFileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`
  return `${(size / 1024 / 1024).toFixed(1)} МБ`
}
