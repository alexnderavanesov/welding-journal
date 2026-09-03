import {
  FIELD_BY_KEY,
  isVirtualWeldField,
  migrateLegacyWeldFieldKey,
  migrateLegacyWeldFieldRecordKeys,
  type WeldFieldKey,
} from '@/lib/weld-fields'
import { isHiddenReportFilterKey } from '@/lib/report-hidden-filters'
import type { WeldTableSection } from '@/lib/weld-table-sections'
import type { WeldSort } from '@/server/weld-contracts'

export type WeldReportColumnPreset = 'compact' | 'chronology' | 'documents' | 'pstoTvmt' | 'custom'

export type WeldReportViewSnapshot = {
  hiddenFieldKeys: WeldFieldKey[]
  collapsedSections: string[]
  columnFilters: Record<string, string>
  sort: WeldSort | null
}

export type SavedWeldReportView = {
  id: string
  name: string
  snapshot: WeldReportViewSnapshot
}

export type WeldReportViewStorage = {
  activePreset: WeldReportColumnPreset
  hiddenFieldKeys: WeldFieldKey[]
  customHiddenFieldKeys: WeldFieldKey[]
  collapsedSections: string[]
  savedViews: SavedWeldReportView[]
}

export const WELD_REPORT_COLUMN_PRESETS: Array<{ id: WeldReportColumnPreset; label: string; description: string }> = [
  { id: 'compact', label: 'Компактно', description: 'Только идентификация стыка и итоговый статус.' },
  { id: 'chronology', label: 'Хронология', description: 'Даты, заявки, результаты и заключения по порядку.' },
  { id: 'documents', label: 'Документы', description: 'Заявки, заключения, диаграммы и системные документы.' },
  { id: 'pstoTvmt', label: 'ПСТО/ТВМТ', description: 'Назначение, циклы ПСТО, ТВМТ и даты этапов.' },
  { id: 'custom', label: 'Мой набор', description: 'Последний набор столбцов, выбранный вручную.' },
]

export function getPresetHiddenFieldKeys({
  preset,
  sections,
  alwaysVisibleFieldKeys,
  customHiddenFieldKeys,
}: {
  preset: WeldReportColumnPreset
  sections: readonly WeldTableSection[]
  alwaysVisibleFieldKeys: ReadonlySet<string>
  customHiddenFieldKeys: ReadonlySet<WeldFieldKey>
}) {
  if (preset === 'custom') return new Set(customHiddenFieldKeys)
  const hidden = new Set<WeldFieldKey>()
  for (const field of sections.flatMap((section) => section.fields)) {
    if (alwaysVisibleFieldKeys.has(field.key)) continue
    if (!isFieldVisibleInPreset(field.key, preset)) hidden.add(field.key)
  }
  return hidden
}

export function createDefaultWeldReportViewStorage(
  defaultCollapsedSections: ReadonlySet<string>,
): WeldReportViewStorage {
  return {
    activePreset: 'custom',
    hiddenFieldKeys: [],
    customHiddenFieldKeys: [],
    collapsedSections: [...defaultCollapsedSections],
    savedViews: [],
  }
}

export function readWeldReportViewStorage(
  storageKey: string,
  defaultCollapsedSections: ReadonlySet<string>,
): WeldReportViewStorage {
  const fallback = createDefaultWeldReportViewStorage(defaultCollapsedSections)
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getStorageKey(storageKey)) ?? 'null') as Partial<WeldReportViewStorage> | null
    if (!parsed) return fallback
    return {
      activePreset: isPreset(parsed.activePreset) ? parsed.activePreset : fallback.activePreset,
      hiddenFieldKeys: normalizeFieldKeys(parsed.hiddenFieldKeys),
      customHiddenFieldKeys: normalizeFieldKeys(parsed.customHiddenFieldKeys),
      collapsedSections: normalizeStrings(parsed.collapsedSections, fallback.collapsedSections),
      savedViews: normalizeSavedViews(parsed.savedViews),
    }
  } catch {
    return fallback
  }
}

export function writeWeldReportViewStorage(storageKey: string, value: WeldReportViewStorage) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(getStorageKey(storageKey), JSON.stringify(value))
}

export function createSavedWeldReportView(
  name: string,
  snapshot: WeldReportViewSnapshot,
  existingId?: string,
): SavedWeldReportView {
  return {
    id: existingId ?? `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    snapshot: normalizeSnapshot(snapshot),
  }
}

function isFieldVisibleInPreset(fieldKey: string, preset: Exclude<WeldReportColumnPreset, 'custom'>) {
  const normalized = fieldKey.toLowerCase()
  if (preset === 'compact') return false
  if (preset === 'pstoTvmt') {
    return normalized.startsWith('psto') || normalized.startsWith('tvmt') || normalized.startsWith('heattreatment')
  }
  if (preset === 'documents') {
    return /request|conclusion|diagram|document|jsr|checklist|zni/.test(normalized)
  }
  return /date|request|result|conclusion|psto|tvmt|heattreatment|status|officiality/.test(normalized)
}

function normalizeSavedViews(value: unknown): SavedWeldReportView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const raw = candidate as Partial<SavedWeldReportView>
    const name = String(raw.name ?? '').trim()
    const id = String(raw.id ?? '').trim()
    if (!name || !id || !raw.snapshot) return []
    return [{ id, name, snapshot: normalizeSnapshot(raw.snapshot) }]
  })
}

function normalizeSnapshot(value: WeldReportViewSnapshot): WeldReportViewSnapshot {
  const columnFilters = migrateLegacyWeldFieldRecordKeys(Object.fromEntries(
    Object.entries(value.columnFilters ?? {})
      .filter(([, filter]) => String(filter ?? '').trim()),
  ))
  const sortFieldKey = value.sort ? migrateLegacyWeldFieldKey(value.sort.fieldKey) : ''
  const sortField = isKnownWeldFieldKey(sortFieldKey) ? FIELD_BY_KEY.get(sortFieldKey) : undefined
  return {
    hiddenFieldKeys: normalizeFieldKeys(value.hiddenFieldKeys),
    collapsedSections: normalizeStrings(value.collapsedSections),
    columnFilters: Object.fromEntries(
      Object.entries(columnFilters)
        .filter(([fieldKey]) => isKnownWeldFieldKey(fieldKey) || isHiddenReportFilterKey(fieldKey)),
    ),
    sort: value.sort && sortField && !isVirtualWeldField(sortField) &&
        (value.sort.direction === 'asc' || value.sort.direction === 'desc')
      ? { fieldKey: sortFieldKey as WeldFieldKey, direction: value.sort.direction }
      : null,
  }
}

function normalizeFieldKeys(value: unknown) {
  return normalizeStrings(value)
    .map(migrateLegacyWeldFieldKey)
    .filter(isKnownWeldFieldKey)
}

function isKnownWeldFieldKey(fieldKey: string): fieldKey is WeldFieldKey {
  return FIELD_BY_KEY.has(fieldKey as WeldFieldKey)
}

function normalizeStrings(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return [...fallback]
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))]
}

function isPreset(value: unknown): value is WeldReportColumnPreset {
  return WELD_REPORT_COLUMN_PRESETS.some((preset) => preset.id === value)
}

function getStorageKey(report: string) {
  return `welding-report-view:v1:${report}`
}
