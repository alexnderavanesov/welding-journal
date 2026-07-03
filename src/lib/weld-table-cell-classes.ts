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
  'pvkRequest',
  'uzkRequest',
  'pstoRequest',
  'tvmtRequest',
  'rfaRequest',
  'stlsRequest',
  'mkkRequest',
])

const RESULT_SECTION_FIELD_KEYS = new Set<WeldFieldKey>([
  'vikResult',
  'rkResult',
  'pvkResult',
  'uzkResult',
  'pstoResult',
  'heatTreatmentDiagram',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'pstoNote',
  'finalStatus',
])

export function headerCellClass(fieldKey: string, isReadOnlyColumn: boolean) {
  const base = 'border-b border-r px-3 py-2.5 text-center text-[13px] font-semibold text-slate-700'
  const width = getWidthClass(fieldKey)
  const border = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never) ? 'border-r-slate-200' : 'border-r-slate-100'
  const readonly = isReadOnlyColumn ? 'bg-slate-200 text-slate-500 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.12)]' : ''
  return `${base} ${width} ${border} ${readonly}`
}

export function bodyCellClass(
  fieldKey: string,
  isReadOnlyColumn: boolean,
  isHighlightedRow: boolean,
  isHighlightedCell: boolean,
  isBlockedEditableCell = false,
) {
  const base = 'border-b border-r border-b-slate-100 p-0 align-top'
  const width = getWidthClass(fieldKey)
  const border = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never) ? 'border-r-slate-200' : 'border-r-slate-100'
  const blockedEditable = isBlockedEditableCell
    ? 'bg-stone-100/90 shadow-[inset_0_0_0_9999px_rgba(120,113,108,0.08)]'
    : ''
  const readonly = isReadOnlyColumn
    ? isHighlightedRow
      ? 'bg-emerald-100/80 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.18)]'
      : 'bg-slate-200/80 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.14)]'
    : ''
  const highlightedRow = isHighlightedRow && !isReadOnlyColumn ? 'bg-emerald-100/70' : ''
  const highlightedCell = isHighlightedCell ? 'bg-lime-200/95 shadow-[inset_0_0_0_9999px_rgba(190,242,100,0.2)]' : ''
  return `${base} ${width} ${border} ${readonly} ${blockedEditable} ${highlightedRow} ${highlightedCell}`
}

export function filterCellClass(fieldKey: string, isReadOnlyColumn: boolean) {
  const base = 'border-b border-r border-b-slate-100 bg-slate-50/70 px-2 py-1.5'
  const border = VISIBLE_SECTION_END_FIELD_KEYS.has(fieldKey as never) ? 'border-r-slate-200' : 'border-r-slate-100'
  const readonly = isReadOnlyColumn ? 'bg-slate-200/90 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.12)]' : ''
  return `${base} ${border} ${readonly}`
}

function getWidthClass(fieldKey: string) {
  const key = fieldKey as WeldFieldKey
  if (fieldKey === 'weldDate') return 'w-28 whitespace-nowrap'
  if (fieldKey === 'pstoDate') return 'w-28 whitespace-nowrap'
  if (fieldKey === 'createdAt' || fieldKey === 'pstoCreatedAt') return 'w-[120px] whitespace-nowrap'
  if (STAMP_FIELD_KEYS.has(key)) return 'w-[126px]'
  if (REQUEST_FIELD_KEYS.has(key)) return 'w-[170px]'
  if (RESULT_SECTION_FIELD_KEYS.has(key)) return 'w-[132px]'
  if (RESULT_FIELD_KEYS.has(key)) return 'w-28 whitespace-nowrap'
  if (isCompactWeldColumn(fieldKey)) return 'w-[82px]'
  return 'max-w-72'
}
