import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { GridApi } from 'ag-grid-community'
import { isModalDialogOpen } from './modal-layer'
import { isContextActionMenuOpen } from './context-action-menu-state'

/** Portals and virtual rows have independent lifetimes; remember the document, not its old element. */
export function useDocumentGridFocus<T>(api: GridApi<T> | null, frame: RefObject<HTMLDivElement | null>) {
  const last = useRef<{ id: string; column: string } | null>(null)
  const remember = useCallback(() => {
    if (!api || api.isDestroyed()) return
    const cell = api.getFocusedCell(), node = cell ? api.getDisplayedRowAtIndex(cell.rowIndex) : undefined
    if (node?.id && cell) last.current = { id: node.id, column: cell.column.getColId() }
  }, [api])
  const restore = useCallback(() => {
    if (!api || api.isDestroyed() || isModalDialogOpen() || isContextActionMenuOpen() || !last.current) return
    const active = document.activeElement
    if (active && active !== document.body && !frame.current?.contains(active)) return
    const column = api.getColumn(last.current.column), node = api.getRowNode(last.current.id)
    if (!column?.isVisible()) return
    if (node?.rowIndex != null) api.setFocusedCell(node.rowIndex, column)
    else api.setFocusedHeader(column)
  }, [api, frame])
  useEffect(() => {
    let opened = isModalDialogOpen() || isContextActionMenuOpen(), scheduled = 0
    const observer = new MutationObserver(() => {
      const next = isModalDialogOpen() || isContextActionMenuOpen()
      if (opened && !next) scheduled = requestAnimationFrame(restore)
      opened = next
    })
    observer.observe(document.body, { childList: true })
    const leave = (event: FocusEvent) => {
      // ContextActionMenu autofocus runs in a layout effect, before its passive
      // effect publishes the open flag. Both the panel (mouse) and its commands
      // (keyboard) are portal focus, not a departure from the grid.
      // Native filter/menu portals likewise belong to the document grid.
      if (event.target instanceof Element && event.target.closest('[data-menu-item], .journal-context-menu, .document-grid-popup-layer')) return
      if (!isModalDialogOpen() && !isContextActionMenuOpen() && event.target instanceof Node && event.target !== document.body && !frame.current?.contains(event.target)) last.current = null
    }
    document.addEventListener('focusin', leave)
    return () => { observer.disconnect(); cancelAnimationFrame(scheduled); document.removeEventListener('focusin', leave) }
  }, [restore, frame])
  return { remember, restore }
}
