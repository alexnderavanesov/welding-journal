import { X } from 'lucide-react'
import { useContext, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { DialogHeadingIdContext } from './dialog-heading-context'

type DialogHeaderProps = {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  actions?: ReactNode
  closeLabel?: string
  closeDisabled?: boolean
}

export function DialogHeader({ title, subtitle, onClose, actions, closeLabel = 'Закрыть', closeDisabled = false }: DialogHeaderProps) {
  const headingId = useContext(DialogHeadingIdContext)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 border-b border-slate-200/80 px-5 py-4 sm:flex sm:justify-between">
      <div className="min-w-0 flex-1">
        <h2 id={headingId} className="text-lg font-semibold">{title}</h2>
        {subtitle ? <p className="break-words text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div> : null}
      <Button variant="ghost" size="icon" className="col-start-2 row-start-1 shrink-0" onClick={onClose} aria-label={closeLabel} disabled={closeDisabled}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
