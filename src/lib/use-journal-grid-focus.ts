import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { GridApi, IRowNode } from 'ag-grid-community'
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
  useEffect(() => {
    const grid = frame.current
    if (!api || !grid) return
    // SSRM restores focus by displayed index. When a group above the checkbox
    // grows from one loading row into its real children, that index can now
    // belong to another joint. Keep the selected checkbox bound to its node.
    let clicked: { node: IRowNode<WeldRow>; index: number; column: string } | null = null
    const clear = () => { clicked = null }
    const rememberCheckbox = (event: Event) => {
      const cell = event.target instanceof Element ? event.target.closest('.ag-cell') : null
      if (!cell?.querySelector('.journal-server-checkbox')) return
      const row = cell.closest('[row-index]')
      const column = cell.getAttribute('col-id')
      const node = row && api.getDisplayedRowAtIndex(Number(row.getAttribute('row-index')))
      if (node && node.rowIndex != null && column) clicked = { node, index: node.rowIndex, column }
    }
    const keydown = (event: KeyboardEvent) => {
      clear()
      if (event.key === ' ' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey &&
        event.target instanceof Element && grid.contains(event.target)) rememberCheckbox(event)
    }
    const align = () => {
      if (!clicked || clicked.node.rowIndex === clicked.index) return
      const active = document.activeElement
      const index = clicked.node.rowIndex
      const { column } = clicked
      if (index == null || isModalDialogOpen() || active !== document.body && !grid.contains(active) ||
        api.getFocusedCell()?.column.getColId() !== column) { clear(); return }
      clicked.index = index
      if (api.getFocusedCell()?.rowIndex === index) return
      const target = grid.querySelector<HTMLElement>(`.ag-row[row-index="${index}"] .ag-cell[col-id="${CSS.escape(column)}"]`)
      if (!target) { clear(); api.clearFocusedCell(); return }
      target.focus({ preventScroll: true })
      api.setFocusedCell(index, column)
    }
    grid.addEventListener('click', rememberCheckbox, true)
    window.addEventListener('keydown', keydown, true)
    for (const event of ['pointerdown', 'wheel']) window.addEventListener(event, clear, { capture: true, passive: true })
    api.addEventListener('modelUpdated', align)
    return () => {
      grid.removeEventListener('click', rememberCheckbox, true)
      window.removeEventListener('keydown', keydown, true)
      for (const event of ['pointerdown', 'wheel']) window.removeEventListener(event, clear, true)
      if (!api.isDestroyed()) api.removeEventListener('modelUpdated', align)
    }
  }, [api, frame])
  return { remember, restore }
}
