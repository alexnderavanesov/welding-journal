import { useEffect, useRef, type ReactNode } from 'react'
import { useWindowEscapeKey } from '@/lib/use-window-escape-key'
import { isContextActionMenuOpen } from '@/lib/context-action-menu-state'
import { LargeDialogShell } from './large-dialog-shell'

/** Shared shell for registry cards and document assignments; never expands a table row. */
export function SpecialistDialogShell({ label, busy, onClose, children, wide = false }: {
  label: string; busy: boolean; onClose: () => void; children: ReactNode; wide?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const previousFocus = useRef(typeof document === 'undefined' ? null : document.activeElement)
  useEffect(() => () => {
    const target = previousFocus.current
    if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true })
  }, [])
  useWindowEscapeKey(true, event => {
    if (event.defaultPrevented || isContextActionMenuOpen() || document.querySelector('[role="tooltip"], [data-specialist-listbox]')) return
    const dialogs = document.querySelectorAll('[data-modal-dialog="true"]')
    if (!dialogs.item(dialogs.length - 1)?.contains(root.current)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!busy) onClose()
  }, { capture: true })
  return <LargeDialogShell ariaLabel={label} maxWidthClassName={wide ? 'max-w-3xl' : 'max-w-xl'}
    maxHeightClassName="max-h-[calc(100dvh-2rem)]" panelRadiusClassName="rounded-xl" panelClassName="overflow-hidden">
    <div ref={root} className="flex min-h-0 flex-col" onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]'))
        .filter(element => element.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>{children}</div>
  </LargeDialogShell>
}
