import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

type RequestDialogHeaderProps = {
  title: string
  subtitle: string
  onClose: () => void
  actions?: ReactNode
}

export function RequestDialogHeader({ title, subtitle, onClose, actions }: RequestDialogHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
