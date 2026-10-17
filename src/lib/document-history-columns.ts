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
  | 'specialistFirst'
  | 'specialistSecond'

export type DocumentHistoryColumnDefinition = {
  key: DocumentHistoryColumnKey
  label: string
  minWidth: number
  align?: 'end'
  dateGrouped?: boolean
  required?: boolean
}

export type DocumentHistoryColumnPreferences = Record<string, DocumentHistoryColumnKey[]>

export function specialistHistoryColumns(thermist = false): DocumentHistoryColumnDefinition[] {
  return [
    { key: 'specialistFirst', label: thermist ? 'Оператор-термист' : 'Провёл контроль', minWidth: 190 },
    { key: 'specialistSecond', label: thermist ? 'Руководитель по ТО' : 'Выдал заключение', minWidth: 190 },
  ]
}

export const GENERATED_DOCUMENT_HISTORY_COLUMNS: readonly DocumentHistoryColumnDefinition[] = [
  { key: 'title', label: 'Документ', minWidth: 280, required: true },
  { key: 'project', label: 'Проект', minWidth: 140 },
  { key: 'subtitle', label: 'Шифр', minWidth: 130 },
  { key: 'line', label: 'Линия', minWidth: 150 },
  { key: 'period', label: 'Период', minWidth: 160, dateGrouped: true },
  { key: 'rowCount', label: 'Стыков', minWidth: 110, align: 'end' },
  { key: 'wdi', label: 'WDI', minWidth: 76, align: 'end' },
  { key: 'updatedAt', label: 'Обновлен', minWidth: 140, dateGrouped: true },
]

export const LAYERED_GENERATED_DOCUMENT_HISTORY_COLUMNS: readonly DocumentHistoryColumnDefinition[] = [
  { key: 'title', label: 'Заключение', minWidth: 280, required: true },
  { key: 'stage', label: 'Этап', minWidth: 100 },
  { key: 'project', label: 'Проект', minWidth: 140 },
  { key: 'subtitle', label: 'Шифр', minWidth: 130 },
  { key: 'line', label: 'Линия', minWidth: 150 },
  { key: 'period', label: 'Дата заключения', minWidth: 150, dateGrouped: true },
  { key: 'rowCount', label: 'Стыков', minWidth: 110, align: 'end' },
  { key: 'updatedAt', label: 'Обновлен', minWidth: 140, dateGrouped: true },
]

export const SYSTEM_DOCUMENT_HISTORY_COLUMNS: readonly DocumentHistoryColumnDefinition[] = [
  { key: 'title', label: 'Документ', minWidth: 280, required: true },
  { key: 'method', label: 'Вид НК', minWidth: 84 },
  { key: 'stage', label: 'Этап', minWidth: 110 },
  { key: 'project', label: 'Проект', minWidth: 130 },
  { key: 'subtitle', label: 'Шифр', minWidth: 120 },
  { key: 'line', label: 'Линия', minWidth: 150 },
  { key: 'rowCount', label: 'Стыков', minWidth: 110, align: 'end' },
  { key: 'date', label: 'Дата', minWidth: 128, dateGrouped: true },
]

const DOCUMENT_HISTORY_COLUMN_KEY_SET = new Set<DocumentHistoryColumnKey>([
  'specialistFirst',
  'specialistSecond',
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

function isDocumentHistoryColumnKey(value: unknown): value is DocumentHistoryColumnKey {
  return typeof value === 'string' && DOCUMENT_HISTORY_COLUMN_KEY_SET.has(value as DocumentHistoryColumnKey)
}
