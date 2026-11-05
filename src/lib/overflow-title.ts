import type { FocusEvent, MouseEvent } from 'react'

type HoverEvent = MouseEvent<HTMLElement> | FocusEvent<HTMLElement>

function clearTitle(event: HoverEvent) {
  event.currentTarget.removeAttribute('title')
}

function revealClippedTitle(event: HoverEvent) {
  const element = event.currentTarget
  const container = element.dataset.overflowContainer
  const target = container ? element.closest<HTMLElement>(container) ?? element : element
  const clipped = [target, ...target.querySelectorAll<HTMLElement>('.truncate, [data-overflow-text]')]
    .some(node => node.clientWidth > 0 && (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight))
  const text = element.dataset.overflowTitle
  if (clipped && text) element.setAttribute('title', text)
  else clearTitle(event)
}

/** Read layout only for the hovered/focused label, never per row on render or resize. */
export function overflowTitle(text: string | null | undefined, container?: string) {
  return {
    'data-overflow-title': text || undefined,
    'data-overflow-container': container,
    onMouseEnter: revealClippedTitle,
    onFocus: revealClippedTitle,
    onMouseLeave: clearTitle,
    onBlur: clearTitle,
  }
}
