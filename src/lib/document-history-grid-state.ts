import type { ColumnState } from 'ag-grid-community'
import type { DocumentHistoryColumnDefinition } from './document-history-columns'

export type DocumentGridAppearance = {
  density: 'compact' | 'comfortable' | 'spacious'
  wrapText: boolean
  stripes: boolean
  verticalLines: boolean
  theme: 'quartz' | 'alpine' | 'balham'
}
export type DocumentGridView = {
  id: string; name: string; columns: ColumnState[]; appearance: DocumentGridAppearance
  filters: Record<string, string>; search: string
}
export type DocumentGridState = {
  columns: ColumnState[]; appearance: DocumentGridAppearance; views: DocumentGridView[]
}
export const DOCUMENT_GRID_DEFAULT_APPEARANCE: DocumentGridAppearance = {
  density: 'comfortable', wrapText: true, stripes: true, verticalLines: false, theme: 'quartz',
}
export function documentGridRowHeight(appearance: Pick<DocumentGridAppearance, 'density' | 'wrapText'>) {
  return appearance.density === 'compact' ? (appearance.wrapText ? 46 : 36) : appearance.density === 'spacious' ? 70 : 56
}
export const DOCUMENT_GRID_GROUP_FIELDS = new Set(['project', 'subtitle', 'line', 'method', 'stage', 'specialistFirst', 'specialistSecond'])
const prefix = 'welding-journal:documents:grid:v1:'

export function normalizeDocumentGridColumns(value: unknown, available: readonly DocumentHistoryColumnDefinition[]): ColumnState[] {
  if (!Array.isArray(value)) return []
  const allowed = new Map(available.map(column => [column.key as string, column]))
  const seen = new Set<string>()
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || !allowed.has(item.colId) || seen.has(item.colId)) return []
    seen.add(item.colId)
    return [{
      colId: item.colId,
      hide: allowed.get(item.colId)?.required ? false : item.hide === true,
      width: Number.isFinite(item.width) ? Math.max(80, Math.min(1600, item.width)) : undefined,
      pinned: item.pinned === 'left' || item.pinned === 'right' ? item.pinned : null,
      sort: item.sort === 'asc' || item.sort === 'desc' ? item.sort : null,
      sortIndex: Number.isInteger(item.sortIndex) && item.sortIndex >= 0 ? item.sortIndex : null,
      rowGroup: DOCUMENT_GRID_GROUP_FIELDS.has(item.colId) && item.rowGroup === true,
      rowGroupIndex: DOCUMENT_GRID_GROUP_FIELDS.has(item.colId) && Number.isInteger(item.rowGroupIndex) && item.rowGroupIndex >= 0 ? item.rowGroupIndex : null,
    } satisfies ColumnState]
  })
}

function appearance(value: unknown): DocumentGridAppearance {
  const raw = value && typeof value === 'object' ? value as Partial<DocumentGridAppearance> : {}
  return {
    density: raw.density === 'compact' || raw.density === 'spacious' ? raw.density : 'comfortable',
    theme: raw.theme === 'alpine' || raw.theme === 'balham' ? raw.theme : 'quartz',
    wrapText: raw.wrapText !== false, stripes: raw.stripes !== false, verticalLines: raw.verticalLines === true,
  }
}

export function readDocumentGridState(viewId: string, columns: readonly DocumentHistoryColumnDefinition[]): DocumentGridState {
  const fallback = { columns: [], appearance: { ...DOCUMENT_GRID_DEFAULT_APPEARANCE }, views: [] }
  try {
    if (typeof window === 'undefined') return fallback
    const raw = JSON.parse(window.localStorage.getItem(prefix + viewId) || 'null')
    if (!raw || typeof raw !== 'object') return fallback
    return {
      columns: normalizeDocumentGridColumns(raw.columns, columns), appearance: appearance(raw.appearance),
      views: Array.isArray(raw.views) ? raw.views.flatMap((view: Partial<DocumentGridView>) => {
        if (typeof view?.id !== 'string' || typeof view.name !== 'string' || !view.name.trim()) return []
        return [{ id: view.id, name: view.name, columns: normalizeDocumentGridColumns(view.columns, columns), appearance: appearance(view.appearance),
          search: typeof view.search === 'string' ? view.search : '',
          filters: view.filters && typeof view.filters === 'object' ? Object.fromEntries(Object.entries(view.filters).filter(([, value]) => typeof value === 'string')) : {},
        }]
      }) : [],
    }
  } catch { return fallback }
}

export function writeDocumentGridState(viewId: string, state: DocumentGridState) {
  try { window.localStorage.setItem(prefix + viewId, JSON.stringify(state)) } catch { /* Keep the working in-memory view when browser storage is unavailable. */ }
}

/** Removing server blocks is a cache event, never a change to the operator's selection. */
export function reconcileDocumentGridSelection<T extends { id: string | number }>(
  selected: readonly T[], matchingIds: readonly (string | number)[] | undefined, loaded: readonly T[],
  requestedIds: readonly (string | number)[] = selected.map(row => row.id),
): T[] {
  const matching = matchingIds ? new Set(matchingIds.map(String)) : null
  const requested = new Set(requestedIds.map(String))
  const snapshots = new Map(loaded.map(row => [String(row.id), row]))
  return selected.filter(row => !matching || !requested.has(String(row.id)) || matching.has(String(row.id))).map(row => snapshots.get(String(row.id)) ?? row)
}
