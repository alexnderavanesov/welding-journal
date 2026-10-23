import type { GridApi } from 'ag-grid-community'

type KeyInput = Pick<KeyboardEvent, 'key' | 'target' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat' | 'preventDefault' | 'stopPropagation'>
/** Header traversal shared by reports, registries and nested program grids.
 * Selection and editing remain the owning table's business commands. */
export function gridHeaderKeyboard(event: KeyInput, api: GridApi, options: {
  toggleSelection?: () => void; openFilter?: (id: string) => void
} = {}): boolean {
  if (!(event.target instanceof Element) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
  const target = event.target
  if (target.closest('.ag-menu, .ag-popup, textarea, select, input:not([type=checkbox]), [contenteditable=true]')) return false
  const consume = () => { event.preventDefault(); event.stopPropagation(); return true }
  const cell = target.closest('.ag-cell')
  if (event.key === 'ArrowUp' && cell?.closest('[row-index]')?.getAttribute('row-index') === '0') {
    const id = cell.getAttribute('col-id')
    if (id) { api.setFocusedHeader(id); return consume() }
  }
  const id = target.closest('.ag-header-cell')?.getAttribute('col-id')
  if (!id) return false
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const columns = api.getAllDisplayedColumns(), index = columns.findIndex(column => column.getColId() === id)
    const next = columns[index + (event.key === 'ArrowLeft' ? -1 : 1)]
    if (index >= 0 && next) { api.ensureColumnVisible(next); api.setFocusedHeader(next) }
    return consume()
  }
  if (event.key === ' ' && !target.closest('button')) {
    if (!event.repeat) {
      if (id === 'ag-Grid-SelectionColumn' && options.toggleSelection) options.toggleSelection()
      else if (api.getColumn(id)?.isFilterAllowed()) { api.setFocusedHeader(id); options.openFilter?.(id); api.showColumnFilter(id) }
      else return false
    }
    return consume()
  }
  return false
}
