import { Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'

type RequestManagerButtonProps = {
  disabled: boolean
  disabledReason?: string
  onClick: () => void
  className?: string
}

export function RequestManagerButton({ disabled, disabledReason, onClick, className = '' }: RequestManagerButtonProps) {
  return (
    <span className="inline-flex shrink-0" title={disabled ? disabledReason : undefined}>
      <Button
        variant="outline"
        onClick={onClick}
        disabled={disabled}
        className={`border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:pointer-events-none disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${className}`.trim()}
      >
        <Pencil className="mr-2 h-4 w-4" />
        Управление заявками
      </Button>
    </span>
  )
}
