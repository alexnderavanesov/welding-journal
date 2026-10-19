import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { GridApi } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { isModalDialogOpen } from './modal-layer'

// Modal shells are portals: removing one otherwise leaves document.body focused.
// Keep an identity, not a row index, because server sorting can move the joint.
export function useJournalGridFocus(api: GridApi<WeldRow> | null, frame: RefObject<HTMLDivElement | null>) {
  const lastCell = useRef<{ id: string; column: string } | null>(null)
  const remember = useCallback(() => {
    const cell = api?.getFocusedCell()
    const node = cell && api?.getDisplayedRowAtIndex(cell.rowIndex)
    if (node?.id && cell) lastCell.current = { id: node.id, column: cell.column.getColId() }
  }, [api])
  const restore = useCallback(() => {
    if (!api || api.isDestroyed() || isModalDialogOpen() || !lastCell.current) return
    const active = document.activeElement
    if (active && active !== document.body && !frame.current?.contains(active)) return
    // A queued modal/menu restoration must not replay an old cell after the
    // operator has already resumed keyboard navigation in the grid.
    if (active?.closest('.ag-cell') && frame.current?.contains(active)) return
    const node = api.getRowNode(lastCell.current.id)
    const column = api.getColumn(lastCell.current.column)
    if (node?.rowIndex != null && column?.isVisible()) api.setFocusedCell(node.rowIndex, column)
  }, [api, frame])
  useEffect(() => {
    let hadModal = isModalDialogOpen()
    let scheduled = 0
    const observer = new MutationObserver(() => {
      const hasModal = isModalDialogOpen()
      if (hadModal && !hasModal) scheduled = requestAnimationFrame(restore)
      hadModal = hasModal
    })
    // Dialog roots are attached directly to body; do not observe virtualised cells.
    observer.observe(document.body, { childList: true })
    return () => { observer.disconnect(); cancelAnimationFrame(scheduled) }
  }, [restore])
  return { remember, restore }
}
