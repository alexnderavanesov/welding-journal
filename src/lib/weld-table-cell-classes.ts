import { isCompactWeldColumn } from '@/lib/weld-column-widths'
import { RESULT_FIELD_KEYS, VISIBLE_SECTION_END_FIELD_KEYS, type WeldFieldKey } from '@/lib/weld-fields'

const STAMP_FIELD_KEYS = new Set<WeldFieldKey>([
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
])

const REQUEST_FIELD_KEYS = new Set<WeldFieldKey>([
  'vikRequest',
  'rkRequest',
  'uzkRequest',
  'pvkRequest',
  'pstoRequest',
  'tvmtRequest',
  'rfaRequest',
  'stlsRequest',
  'mkkRequest',
])

const RESULT_SECTION_FIELD_KEYS = new Set<WeldFieldKey>([
  'vikResult',
  'rkResult',
  'uzkResult',
  'pvkResult',
  'pstoResult',
  'heatTreatmentDiagram',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'pstoNote',
  'finalStatus',
])

export function headerCellClass(fieldKey: string, isReadOnlyColumn: boolean, isSectionEnd = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never)) {
  const base = 'border-b-2 border-r border-b-[#d3e3ee] bg-[#f8fbfd] px-3 py-2.5 text-center text-[13px] font-semibold text-slate-700 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.86)]'
  const width = getWidthClass(fieldKey)
  const border = isSectionEnd ? 'border-r-2 border-r-[#d3e3ee]' : 'border-r-[#e7f0f6]'
  const readonly = isReadOnlyColumn ? 'text-slate-600' : ''
  return `${base} ${width} whitespace-normal ${border} ${readonly}`
}

export function bodyCellClass(
  fieldKey: string,
  isReadOnlyColumn: boolean,
  isHighlightedRow: boolean,
  isHighlightedCell: boolean,
  isBlockedEditableCell = false,
  isSectionEnd = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never),
) {
  const base = 'border-b border-r border-b-[#edf2f7] p-0 align-top'
  const width = getWidthClass(fieldKey)
  const border = isSectionEnd ? 'border-r-2 border-r-[#d7e4ee]' : 'border-r-[#edf2f7]'
  const blockedEditable = isBlockedEditableCell
    ? 'bg-amber-50/70 shadow-[inset_0_0_0_9999px_rgba(251,191,36,0.08)]'
    : ''
  const readonly = isReadOnlyColumn
    ? isHighlightedRow
      ? 'bg-emerald-50/70 shadow-[inset_0_0_0_9999px_rgba(16,185,129,0.06)]'
      : ''
    : ''
  const highlightedRow = isHighlightedRow && !isReadOnlyColumn ? 'bg-emerald-50/80' : ''
  const highlightedCell = isHighlightedCell ? 'bg-lime-100/95 shadow-[inset_0_0_0_9999px_rgba(190,242,100,0.16)]' : ''
  return `${base} ${width} ${border} ${readonly} ${blockedEditable} ${highlightedRow} ${highlightedCell}`
}

export function filterCellClass(fieldKey: string, isReadOnlyColumn: boolean, isSectionEnd = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never)) {
  const base = 'border-b border-r border-b-[#edf2f7] bg-[#fbfdfe] px-2 py-1.5'
  const border = isSectionEnd ? 'border-r-2 border-r-[#d7e4ee]' : 'border-r-[#edf2f7]'
  const readonly = isReadOnlyColumn ? 'text-slate-600' : ''
  return `${base} ${border} ${readonly}`
}

function getWidthClass(fieldKey: string) {
  const key = fieldKey as WeldFieldKey
  if (fieldKey === 'weldDate') return 'w-[124px] whitespace-nowrap'
  if (fieldKey === 'pstoDate') return 'w-[124px] whitespace-nowrap'
  if (fieldKey === 'createdAt' || fieldKey === 'pstoCreatedAt') return 'w-[132px] whitespace-nowrap'
  if (STAMP_FIELD_KEYS.has(key)) return 'w-[138px]'
  if (REQUEST_FIELD_KEYS.has(key)) return 'w-[182px]'
  if (RESULT_SECTION_FIELD_KEYS.has(key)) return 'w-[144px]'
  if (RESULT_FIELD_KEYS.has(key)) return 'w-[124px] whitespace-nowrap'
  if (isCompactWeldColumn(fieldKey)) return 'w-[94px]'
  return 'max-w-72'
}
