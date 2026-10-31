import { useLayoutEffect, useRef } from 'react'
import { shouldDeferModalEscape } from './use-report-modal-escape-key'
import { isTopModalDialog } from './modal-layer'

export function useContainedDialogFocus(onClose: () => void, busy = false, enabled = true) {
  const ref = useRef<HTMLDivElement>(null)
  const current = useRef({ onClose, busy }); current.current = { onClose, busy }
  useLayoutEffect(() => {
    if (!enabled) return
    const panel = ref.current
    panel?.setAttribute('data-contained-dialog-focus', 'true')
    const previous = document.activeElement
    const controls = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? [])].filter(element => element.getClientRects().length)
    controls()[0]?.focus()
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || shouldDeferModalEscape(panel)) return
      if (event.key === 'Escape') {
        // Clicking text can move focus to body (especially in Safari). Escape
        // belongs to the top dialog, not only to its focused controls.
        if (!isTopModalDialog(panel)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!current.current.busy) current.current.onClose()
      }
      if (event.key === 'Tab' && ref.current?.contains(document.activeElement)) {
        const fields = controls(), first = fields[0], last = fields.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', handle, true)
    return () => { panel?.removeAttribute('data-contained-dialog-focus'); window.removeEventListener('keydown', handle, true); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [enabled])
  return ref
}
