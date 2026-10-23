import type { ColumnState } from 'ag-grid-community'
import type { WeldRow } from '@/lib/dispatcher-types'
import { FIELD_BY_KEY, DATE_TIME_WELD_FIELD_KEYS, type WeldFieldKey } from '@/lib/weld-fields'
import { formatDate, formatDateTimeWithSeconds } from '@/lib/weld-table-formatting'
import { formatFinalStatusDisplay } from '@/lib/weld-status'
import { gridClipboardNumber } from './grid-clipboard-number'

export type JournalAppearance = {
  theme: 'quartz' | 'alpine' | 'balham'
  density: 'compact' | 'comfortable' | 'spacious'
  verticalLines: boolean
  stripes: boolean
  taskFill: boolean
  wrapText: boolean
}
export const DEFAULT_JOURNAL_APPEARANCE: JournalAppearance = {
  theme: 'quartz',
  density: 'comfortable', verticalLines: false, stripes: true, taskFill: true, wrapText: true,
}
export const JOURNAL_GRID_STORAGE_KEY = 'welding-journal-ag-grid:v1'
export const JOURNAL_GROUP_LABEL_COLUMN = '__groupLabel'
export type JournalLayout = { columns: ColumnState[]; appearance: JournalAppearance }
export type JournalGridStorage = JournalLayout & { views: Record<string, JournalLayout> }

export function normalizeJournalAppearance(value?: Partial<JournalAppearance>): JournalAppearance {
  return {
    theme: value?.theme === 'alpine' || value?.theme === 'balham' ? value.theme : 'quartz',
    density: value?.density === 'compact' || value?.density === 'spacious' ? value.density : 'comfortable',
    verticalLines: typeof value?.verticalLines === 'boolean' ? value.verticalLines : false,
    stripes: typeof value?.stripes === 'boolean' ? value.stripes : true,
    taskFill: typeof value?.taskFill === 'boolean' ? value.taskFill : true,
    wrapText: typeof value?.wrapText === 'boolean' ? value.wrapText : true,
  }
}

// Visibility and sorting belong to the existing report views/server query. Never
// restore them from AG Grid's independent sizing/order state.
export function journalColumnLayout(columns: ColumnState[]): ColumnState[] {
  return columns.filter(column => typeof column.colId === 'string' && column.colId !== JOURNAL_GROUP_LABEL_COLUMN).map(column => ({
    colId: column.colId,
    ...(typeof column.width === 'number' && Number.isFinite(column.width)
      ? { width: Math.max(48, Math.min(1200, column.width)) } : {}),
    ...(column.pinned === 'left' || column.pinned === 'right' || column.pinned === null
      ? { pinned: column.pinned } : {}),
    rowGroup: column.rowGroup === true,
    rowGroupIndex: column.rowGroup === true && typeof column.rowGroupIndex === 'number' ? column.rowGroupIndex : null,
  }))
}

export function readJournalGridStorage(storageKey = JOURNAL_GRID_STORAGE_KEY): JournalGridStorage {
  const fallback = { columns: [], appearance: DEFAULT_JOURNAL_APPEARANCE, views: {} }
  if (typeof window === 'undefined') return fallback
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (!value || typeof value !== 'object') return fallback
    const layout = (entry: Partial<JournalLayout>): JournalLayout => ({
      columns: journalColumnLayout(Array.isArray(entry?.columns) ? entry.columns.filter(Boolean) : []),
      appearance: normalizeJournalAppearance(entry?.appearance),
    })
    return { ...layout(value), views: Object.fromEntries(
      Object.entries(value.views ?? {}).filter(([, entry]) => entry && typeof entry === 'object')
        .map(([name, entry]) => [name, layout(entry as JournalLayout)]),
    ) }
  } catch { return fallback }
}

export function writeJournalGridStorage(value: JournalGridStorage, storageKey = JOURNAL_GRID_STORAGE_KEY) {
  try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* Private/full storage: keep the current session usable. */ }
}

export function journalClipboardValue(row: WeldRow, fieldKey: WeldFieldKey, value: unknown): string {
  const field = FIELD_BY_KEY.get(fieldKey)
  if (fieldKey === 'finalStatus') return formatFinalStatusDisplay(row, value)
  if (field?.kind === 'date') return formatDate(value)
  if (DATE_TIME_WELD_FIELD_KEYS.has(fieldKey)) return formatDateTimeWithSeconds(value)
  if (value === true) return 'да'
  if (value === false || value == null) return ''
  if (field?.kind === 'number') return gridClipboardNumber(value)
  return String(value)
}

const JOURNAL_NUMBER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
export const formatJournalNumber = (value: number) => JOURNAL_NUMBER.format(value)

export function journalNumericValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const text = String(value).trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

export function journalFilterValueLabel(fieldKey: WeldFieldKey, label: string): string {
  const number = FIELD_BY_KEY.get(fieldKey)?.kind === 'number' ? journalNumericValue(label) : null
  return number === null ? label : formatJournalNumber(number)
}

export type JournalRangeSummary = { count: number; numericCount: number; sum: number; average: number | null }
