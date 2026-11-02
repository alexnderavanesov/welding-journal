import { createContext, useContext, useRef, type ReactNode } from 'react'
import type { ColumnState, GridApi, GridState } from 'ag-grid-community'

type Expansion = NonNullable<GridState['ssrmRowGroupExpansion']>
type SavedGroups = { columns: string[]; expansion: Expansion }
const Context = createContext<Map<string, SavedGroups> | null>(null)

/** One entry per report/registry, owned by the current authenticated page.
 * No row objects, requests, grid instances or browser-storage writes are retained.
 * Native bulk state represents "expand all" as a flag plus explicit exceptions. */
export function ReportGroupSessionProvider({ children }: { children: ReactNode }) {
  const sessions = useRef(new Map<string, SavedGroups>())
  return <Context.Provider value={sessions.current}>{children}</Context.Provider>
}

function groupColumns(columns: readonly ColumnState[]) {
  return columns.filter(column => column.rowGroup)
    .sort((a, b) => (a.rowGroupIndex ?? 0) - (b.rowGroupIndex ?? 0)).map(column => column.colId)
}
function copyExpansion(value: Expansion): Expansion {
  return 'expandAll' in value
    ? { expandAll: value.expandAll, invertedRowGroupIds: [...value.invertedRowGroupIds] }
    : { expandedRowGroupIds: [...value.expandedRowGroupIds], collapsedRowGroupIds: value.collapsedRowGroupIds ? [...value.collapsedRowGroupIds] : undefined }
}

export function useReportGroupSession(view: string, columns: readonly ColumnState[], enabled = true) {
  const sessions = useContext(Context)
  const initial = useRef<GridState | undefined>(undefined)
  const initialized = useRef(false)
  if (!initialized.current) {
    initialized.current = true
    const saved = enabled ? sessions?.get(view) : undefined
    if (saved && JSON.stringify(saved.columns) === JSON.stringify(groupColumns(columns))) {
      // Initialise grouping together with expansion. Reapplying the same saved
      // column layout must not replace the restored expansion strategy later.
      initial.current = { partialColumnState: true, rowGroup: { groupColIds: [...saved.columns] }, ssrmRowGroupExpansion: copyExpansion(saved.expansion) }
    }
  }
  return {
    initialState: initial.current,
    capture: (api: GridApi) => {
      if (!sessions || !enabled) return
      const state = api.getState()
      const expansion = state.ssrmRowGroupExpansion ?? state.rowGroupExpansion
      if (expansion) sessions.set(view, { columns: api.getRowGroupColumns().map(column => column.getColId()), expansion: copyExpansion(expansion) })
      else sessions.delete(view)
    },
  }
}
