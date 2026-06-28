import { Badge } from '@/components/ui/badge'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isCompactWeldColumn } from '@/lib/weld-column-widths'
import { RESULT_FIELD_KEYS, VISIBLE_SECTION_END_FIELD_KEYS, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

const collapsedSectionsStoragePrefix = 'welding-tracker-collapsed-sections'

const DUPLICATE_CHECK_FIELD_KEYS: WeldFieldKey[] = [
  'projectTitle',
  'subtitleCode',
  'line',
  'joint',
]

export function formatDate(value: unknown) {
  if (!value) return ''
  const text = String(value)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[3]}.${match[2]}.${match[1]}`
  return text
}

export function formatDateTime(value: unknown) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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
  if (fieldKey === 'weldDate') return 'w-28 whitespace-nowrap'
  if (fieldKey === 'pstoDate') return 'w-28 whitespace-nowrap'
  if (fieldKey === 'createdAt' || fieldKey === 'pstoCreatedAt') return 'w-[120px] whitespace-nowrap'
  if (RESULT_FIELD_KEYS.has(fieldKey as WeldFieldKey)) return 'w-28 whitespace-nowrap'
  if (fieldKey === 'finalStatus') return 'w-[124px]'
  if (isCompactWeldColumn(fieldKey)) return 'w-[82px]'
  return 'max-w-72'
}

export function canCollapseSection(fields: Array<{ key: WeldFieldKey }>, alwaysVisibleFieldKeys: ReadonlySet<WeldFieldKey>) {
  return fields.some((field) => !alwaysVisibleFieldKeys.has(field.key))
}

export function getTableLabel(fieldKey: string, label: string) {
  const tableLabel = fieldKey === 'orderCode1' ? 'ID материала 1' : fieldKey === 'orderCode2' ? 'ID материала 2' : label
  if (tableLabel.endsWith(' - факт')) {
    return (
      <span className="inline-flex flex-col items-center leading-tight">
        <span>{capitalizeFirstLetter(tableLabel.replace(' - факт', ''))}</span>
        <span className="text-[12px] font-medium text-slate-500">факт</span>
      </span>
    )
  }
  return capitalizeFirstLetter(tableLabel)
}

function capitalizeFirstLetter(value: string) {
  const firstLetterIndex = value.search(/\S/)
  if (firstLetterIndex === -1) return value
  return `${value.slice(0, firstLetterIndex)}${value[firstLetterIndex].toLocaleUpperCase('ru-RU')}${value.slice(firstLetterIndex + 1)}`
}

export function getDuplicateKeys(rows: WeldRow[]) {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const key = getDuplicateKey(row)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key))
}

export function getDuplicateKey(row: WeldInput) {
  if (isUnofficialJoint(row)) return null
  const values = DUPLICATE_CHECK_FIELD_KEYS.map((key) => normalizeDuplicateValue(row[key]))
  if (values.every((value) => value === '')) return null
  return values.join('|')
}

function isUnofficialJoint(row: WeldInput) {
  const status = normalizeDuplicateValue(row.status)
  return status === 'неофициальный'
}

export function getCellKey(rowId: number, fieldKey: WeldFieldKey) {
  return `${rowId}:${fieldKey}`
}

function getCollapsedSectionsStorageKey(storageKey: string) {
  return `${collapsedSectionsStoragePrefix}:${storageKey}`
}

export function readCollapsedSections(storageKey: string) {
  if (typeof window === 'undefined') return new Set<string>()

  try {
    const stored = window.localStorage.getItem(getCollapsedSectionsStorageKey(storageKey))
    if (!stored) return new Set<string>()
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? new Set(parsed.filter((value): value is string => typeof value === 'string')) : new Set<string>()
  } catch {
    return new Set<string>()
  }
}

export function writeCollapsedSections(storageKey: string, sections: ReadonlySet<string>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(getCollapsedSectionsStorageKey(storageKey), JSON.stringify([...sections]))
}

function normalizeDuplicateValue(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, '').trim().toLowerCase()
}

export function isYesText(value: unknown) {
  return String(value ?? '').toLowerCase() === 'да'
}

export function isNoText(value: unknown) {
  return String(value ?? '').toLowerCase() === 'нет'
}

export function isCancelledText(value: unknown) {
  return String(value ?? '').toLowerCase() === 'отменен'
}

export function YesBadge() {
  return <Badge className="bg-background px-2 py-0.5 text-xs font-normal text-slate-600">да</Badge>
}

export function CancelledBadge() {
  return <Badge className="bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-700">отменен</Badge>
}

export function ResultBadge({ value }: { value: unknown }) {
  const text = String(value ?? '').trim()
  const normalized = text.toLowerCase()
  if (!text) return ''

  const className =
    normalized === 'годен' || normalized === 'проведено'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : normalized === 'ремонт' || normalized === 'вырез' || normalized === 'не годен' || normalized === 'ошибка'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : normalized === 'ожидает' || normalized === 'ожидает нк'
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : normalized === 'нет потребности'
            ? 'border-slate-300 bg-slate-100 text-slate-600'
          : 'border-slate-200 bg-slate-50 text-slate-600'

  return (
    <Badge
      variant="outline"
      className={`inline-flex max-w-full justify-center whitespace-normal break-words px-1.5 py-0.5 text-center text-[11px] font-normal leading-tight ${className}`}
    >
      {text}
    </Badge>
  )
}
