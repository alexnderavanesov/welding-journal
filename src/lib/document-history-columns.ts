export const DOCUMENT_HISTORY_COLUMNS_STORAGE_KEY = 'welding-journal:documents:history-columns'

export type DocumentHistoryColumnKey =
  | 'title'
  | 'project'
  | 'subtitle'
  | 'line'
  | 'period'
  | 'updatedAt'
  | 'method'
  | 'stage'
  | 'date'
  | 'rowCount'
  | 'wdi'

export type DocumentHistoryColumnDefinition = {
  key: DocumentHistoryColumnKey
  label: string
  gridTrack: string
  minWidth: number
  align?: 'end'
  dateGrouped?: boolean
  required?: boolean
}

export type DocumentHistoryColumnPreferences = Record<string, DocumentHistoryColumnKey[]>

export const GENERATED_DOCUMENT_HISTORY_COLUMNS: readonly DocumentHistoryColumnDefinition[] = [
  { key: 'title', label: 'Документ', gridTrack: 'minmax(280px, 1.5fr)', minWidth: 280, required: true },
  { key: 'project', label: 'Проект', gridTrack: 'minmax(140px, 0.72fr)', minWidth: 140 },
  { key: 'subtitle', label: 'Шифр', gridTrack: 'minmax(130px, 0.66fr)', minWidth: 130 },
  { key: 'line', label: 'Линия', gridTrack: 'minmax(150px, 0.72fr)', minWidth: 150 },
  { key: 'period', label: 'Период', gridTrack: 'minmax(160px, 0.75fr)', minWidth: 160, dateGrouped: true },
  { key: 'rowCount', label: 'Стыков', gridTrack: '84px', minWidth: 84, align: 'end' },
  { key: 'wdi', label: 'WDI', gridTrack: '76px', minWidth: 76, align: 'end' },
  { key: 'updatedAt', label: 'Обновлен', gridTrack: '140px', minWidth: 140, dateGrouped: true },
]

export const SYSTEM_DOCUMENT_HISTORY_COLUMNS: readonly DocumentHistoryColumnDefinition[] = [
  { key: 'title', label: 'Документ', gridTrack: 'minmax(280px, 1.5fr)', minWidth: 280, required: true },
  { key: 'method', label: 'Вид НК', gridTrack: '84px', minWidth: 84 },
  { key: 'stage', label: 'Этап', gridTrack: '110px', minWidth: 110 },
  { key: 'project', label: 'Проект', gridTrack: 'minmax(130px, 0.6fr)', minWidth: 130 },
  { key: 'subtitle', label: 'Шифр', gridTrack: 'minmax(120px, 0.58fr)', minWidth: 120 },
  { key: 'line', label: 'Линия', gridTrack: 'minmax(150px, 0.68fr)', minWidth: 150 },
  { key: 'rowCount', label: 'Стыков', gridTrack: '84px', minWidth: 84, align: 'end' },
  { key: 'date', label: 'Дата', gridTrack: '128px', minWidth: 128, dateGrouped: true },
]

const DOCUMENT_HISTORY_COLUMN_KEY_SET = new Set<DocumentHistoryColumnKey>([
  'title',
  'project',
  'subtitle',
  'line',
  'period',
  'updatedAt',
  'method',
  'stage',
  'date',
  'rowCount',
  'wdi',
])

export function parseDocumentHistoryColumnPreferences(
  rawValue: string | null,
): DocumentHistoryColumnPreferences {
  if (!rawValue) return {}
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const result: DocumentHistoryColumnPreferences = {}
    for (const [viewId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue
      const keys = Array.from(new Set(value.filter(isDocumentHistoryColumnKey)))
      if (keys.length > 0) result[viewId] = keys
    }
    return result
  } catch {
    return {}
  }
}

export function getVisibleDocumentHistoryColumns({
  viewId,
  availableColumns,
  preferences,
}: {
  viewId: string
  availableColumns: readonly DocumentHistoryColumnDefinition[]
  preferences: DocumentHistoryColumnPreferences
}) {
  const preferredKeys = preferences[viewId]
  if (!preferredKeys) return [...availableColumns]

  const preferredSet = new Set(preferredKeys)
  return availableColumns.filter((column) => column.required || preferredSet.has(column.key))
}

export function setVisibleDocumentHistoryColumns({
  viewId,
  visibleColumnKeys,
  availableColumns,
  preferences,
}: {
  viewId: string
  visibleColumnKeys: readonly DocumentHistoryColumnKey[]
  availableColumns: readonly DocumentHistoryColumnDefinition[]
  preferences: DocumentHistoryColumnPreferences
}): DocumentHistoryColumnPreferences {
  const visibleSet = new Set(visibleColumnKeys)
  const normalizedKeys = availableColumns
    .filter((column) => column.required || visibleSet.has(column.key))
    .map((column) => column.key)
  return { ...preferences, [viewId]: normalizedKeys }
}

export function getDocumentHistoryGridLayout({
  columns,
  actionsWidth,
}: {
  columns: readonly DocumentHistoryColumnDefinition[]
  actionsWidth: number
}) {
  const trackCount = columns.length + 2
  return {
    gridTemplateColumns: ['34px', ...columns.map((column) => column.gridTrack), `${actionsWidth}px`].join(' '),
    minWidth: 34
      + columns.reduce((sum, column) => sum + column.minWidth, 0)
      + actionsWidth
      + Math.max(0, trackCount - 1) * 16
      + 32,
  }
}

export function retainVisibleDocumentHistoryColumnFilters(
  filters: Record<string, string>,
  visibleColumnKeys: ReadonlySet<DocumentHistoryColumnKey>,
) {
  const next = Object.fromEntries(
    Object.entries(filters).filter(([key]) => visibleColumnKeys.has(key as DocumentHistoryColumnKey)),
  )
  return Object.keys(next).length === Object.keys(filters).length ? filters : next
}

function isDocumentHistoryColumnKey(value: unknown): value is DocumentHistoryColumnKey {
  return typeof value === 'string' && DOCUMENT_HISTORY_COLUMN_KEY_SET.has(value as DocumentHistoryColumnKey)
}
