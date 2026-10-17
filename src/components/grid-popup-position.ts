import type { PostProcessPopupParams } from 'ag-grid-community'

// The grid can extend below the viewport. AG also calls this after async
// filter options resize the popup, keeping both menus and filters reachable.
export function positionGridPopup({ ePopup }: PostProcessPopupParams) {
  const rect = ePopup.getBoundingClientRect()
  const dy = Math.max(12 - rect.top, Math.min(0, window.innerHeight - 12 - rect.bottom))
  const dx = Math.max(12 - rect.left, Math.min(0, window.innerWidth - 12 - rect.right))
  if (dy) ePopup.style.top = `${parseFloat(ePopup.style.top || '0') + dy}px`
  if (dx) ePopup.style.left = `${parseFloat(ePopup.style.left || '0') + dx}px`
}
