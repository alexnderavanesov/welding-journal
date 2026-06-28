import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

type DialogHeaderProps = {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  actions?: ReactNode
  closeLabel?: string
}

export function DialogHeader({ title, subtitle, onClose, actions, closeLabel = 'Закрыть' }: DialogHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
