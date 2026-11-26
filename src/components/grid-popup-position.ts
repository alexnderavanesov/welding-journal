import type { PostProcessPopupParams } from 'ag-grid-community'
import './filter-popup-resize.css'

const prepared = new WeakSet<HTMLElement>()
// The grid can extend below the viewport. AG also calls this after async
// filter options resize the popup, keeping both menus and filters reachable.
export function positionGridPopup({ ePopup }: PostProcessPopupParams) {
  if (!prepared.has(ePopup)) {
    prepared.add(ePopup)
    // A filter can finish opening before its search field receives focus.
    // A resize is an interaction with this popup, so Escape belongs here.
    ePopup.addEventListener('mousedown', event => {
      if (!(event.target instanceof Element) || !event.target.closest('.ag-resizer')) return
      event.preventDefault()
      if (ePopup.contains(ePopup.ownerDocument.activeElement)) return
      const search = ePopup.querySelector<HTMLElement>('input:is([type="text"], [type="search"]):not(:disabled), input:not([type]):not(:disabled)')
      search?.focus({ preventScroll: true })
      if (!ePopup.contains(ePopup.ownerDocument.activeElement)) {
        if (!ePopup.hasAttribute('tabindex')) ePopup.tabIndex = -1
        ePopup.focus({ preventScroll: true })
      }
    }, true)
  }
  const rect = ePopup.getBoundingClientRect()
  const dy = Math.max(12 - rect.top, Math.min(0, window.innerHeight - 12 - rect.bottom))
  const dx = Math.max(12 - rect.left, Math.min(0, window.innerWidth - 12 - rect.right))
  if (dy) ePopup.style.top = `${parseFloat(ePopup.style.top || '0') + dy}px`
  if (dx) ePopup.style.left = `${parseFloat(ePopup.style.left || '0') + dx}px`
}
