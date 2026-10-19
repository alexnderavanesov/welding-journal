import type { ColumnState } from 'ag-grid-community'

export type ProgramGridKind = 'lines' | 'stamps' | 'joints' | 'assignments'
export type ProgramGridSettings = { columns: ColumnState[] }
const key = (kind: ProgramGridKind) => `welding:line-program:grid:${kind}:v2`
export const defaultProgramGridSettings = (): ProgramGridSettings => ({ columns: [] })

/** Only presentation survives a browser restart. No filters, selection or drafts. */
export function programGridColumns(columns: readonly ColumnState[]): ColumnState[] {
  return columns.filter(column => typeof column.colId === 'string' && !column.colId.startsWith('ag-')).map(column => ({
    colId: column.colId, width: Math.max(48, Math.min(2400, Number(column.width) || 160)),
    flex: typeof column.flex === 'number' && Number.isFinite(column.flex) && column.flex > 0 ? column.flex : null,
  }))
}

export function readProgramGridSettings(kind: ProgramGridKind): ProgramGridSettings {
  const defaults = defaultProgramGridSettings()
  try {
    const value = JSON.parse(localStorage.getItem(key(kind)) ?? 'null')
    if (!value || typeof value !== 'object') return defaults
    return {
      columns: Array.isArray(value.columns) ? programGridColumns(value.columns.filter((item: unknown) => item && typeof item === 'object')) : [],
    }
  } catch { return defaults }
}

export function writeProgramGridSettings(kind: ProgramGridKind, settings: ProgramGridSettings) {
  try { localStorage.setItem(key(kind), JSON.stringify({ ...settings, columns: programGridColumns(settings.columns) })) } catch { return /* A blocked storage must not disable the table. */ }
  window.dispatchEvent(new CustomEvent('program-grid-settings', { detail: kind }))
}
