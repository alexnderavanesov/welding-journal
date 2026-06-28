import { Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'

type RequestManagerButtonProps = {
  disabled: boolean
  onClick: () => void
  className?: string
}

export function RequestManagerButton({ disabled, onClick, className = '' }: RequestManagerButtonProps) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${className}`.trim()}
    >
      <Pencil className="mr-2 h-4 w-4" />
      Управление заявками
    </Button>
  )
}
