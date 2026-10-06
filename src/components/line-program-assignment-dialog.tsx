import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { LargeDialogShell } from './large-dialog-shell'
import { shouldDeferModalEscape } from '@/lib/use-report-modal-escape-key'

/** State and data stay in the line workspace; closing this shell never discards a draft. */
export function LineProgramAssignmentDialog({ line, context, busy, children, toolbar, summary, review, actions, scopeControl, searchControl, onClose }: {
  line: string; context: ReactNode; busy: boolean; children: ReactNode; toolbar?: ReactNode; summary?: ReactNode; review?: ReactNode; actions?: ReactNode; scopeControl?: ReactNode; searchControl?: ReactNode; onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    closeButton.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <LargeDialogShell ariaLabel={`Назначения · ${line}`} maxWidthClassName="max-w-[1480px]" maxHeightClassName="max-h-[94dvh]" panelRadiusClassName="rounded-2xl" panelClassName="h-[min(900px,94dvh)] min-w-0 overflow-hidden">
    <div ref={panel} className="flex min-h-0 flex-1 flex-col" onKeyDown={event => {
      if (shouldDeferModalEscape() || !panel.current?.contains(document.activeElement)) return
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose() }
      if (event.key === 'Tab') {
        const fields = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'))
        const first = fields[0], last = fields.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header data-testid="assignment-dialog-header" className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-slate-200 px-4 py-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="min-w-0"><h2 className="text-lg font-semibold text-slate-900">Назначения</h2><div className="mt-1 break-words text-sm text-slate-600">{context}</div></div>
        {searchControl || scopeControl ? <div data-testid="assignment-dialog-filters" className="col-span-2 row-start-2 grid w-full min-w-0 max-w-[34rem] grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-2 justify-self-end lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:w-[34rem] lg:self-center">
          <div className="min-w-0">{searchControl}</div><div className="min-w-0 [&>select]:w-full [&>select]:max-w-none">{scopeControl}</div>
        </div> : null}
        <button ref={closeButton} type="button" aria-label="Закрыть назначения" disabled={busy} className="col-start-2 row-start-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 lg:col-start-3" onClick={onClose}><X className="h-5 w-5" /></button>
      </header>
      {toolbar ? <div className="max-h-[42dvh] shrink-0 overflow-y-auto [scrollbar-gutter:stable]">{toolbar}</div> : null}
      <div data-testid="assignment-dialog-body" className="min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable] [overflow-anchor:none]">{children}</div>
      <footer data-testid="assignment-dialog-footer" className="shrink-0 border-t border-slate-200 bg-slate-50/70 px-5 py-2.5">
        {review}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">{summary}</div>
          <div className="flex items-center gap-2"><button type="button" disabled={busy} onClick={onClose} title="Закрыть без сохранения. Черновик останется до ухода из раздела." className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">Вернуться к просмотру</button>{actions}</div>
        </div>
      </footer>
    </div>
  </LargeDialogShell>
}
