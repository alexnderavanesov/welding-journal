import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { SpecialistDialogShell } from './specialist-dialog-shell'
import { Button } from './ui/button'

export function AccessDialog({ title, description, busy = false, wide = false, onClose, children, footer }: {
  title: string; description?: string; busy?: boolean; wide?: boolean; onClose: () => void; children: ReactNode; footer: ReactNode
}) {
  return <SpecialistDialogShell label={title} busy={busy} onClose={onClose} maxWidthClassName={wide ? 'max-w-6xl' : 'max-w-xl'}>
    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
      <div><h2 className="text-lg font-semibold text-slate-900">{title}</h2>{description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}</div>
      <Button type="button" variant="ghost" size="icon" autoFocus aria-label="Закрыть окно" disabled={busy} onClick={onClose}><X className="h-5 w-5" /></Button>
    </header>
    <div className="min-h-0 overflow-auto overscroll-contain"><div className="p-6">{children}</div></div>
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">{footer}</footer>
  </SpecialistDialogShell>
}
