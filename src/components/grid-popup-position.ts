import type { PostProcessPopupParams } from 'ag-grid-community'
import './filter-popup-resize.css'

const prepared = new WeakSet<HTMLElement>()
// The grid can extend below the viewport. AG also calls this after async
// filter options resize the popup, keeping both menus and filters reachable.
export function positionGridPopup({ ePopup }: PostProcessPopupParams) {
  if (!prepared.has(ePopup)) {
    prepared.add(ePopup)
    // AG's resize div is not focusable. Keep focus in the filter so Escape
    // and typing still work after dragging, including in nested program grids.
    ePopup.addEventListener('mousedown', event => {
      if (event.target instanceof Element && event.target.closest('.ag-resizer')) event.preventDefault()
    }, true)
  }
  const rect = ePopup.getBoundingClientRect()
  const dy = Math.max(12 - rect.top, Math.min(0, window.innerHeight - 12 - rect.bottom))
  const dx = Math.max(12 - rect.left, Math.min(0, window.innerWidth - 12 - rect.right))
  if (dy) ePopup.style.top = `${parseFloat(ePopup.style.top || '0') + dy}px`
  if (dx) ePopup.style.left = `${parseFloat(ePopup.style.left || '0') + dx}px`
}
