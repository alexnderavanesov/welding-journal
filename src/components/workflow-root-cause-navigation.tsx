import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'

export type WorkflowRootCauseNavigationProps = {
  actionLabel: string
  depth: number
  onReturn: () => void
}

export function WorkflowRootCauseNavigation({
  actionLabel,
  depth,
  onReturn,
}: WorkflowRootCauseNavigationProps) {
  return (
    <div className="fixed left-1/2 top-3 z-[130] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-md border border-sky-200 bg-white px-3 py-2 shadow-lg shadow-slate-950/10">
      <Button type="button" size="sm" variant="outline" onClick={onReturn}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Вернуться к исходному окну
      </Button>
      <span className="min-w-0 truncate text-xs font-medium text-slate-600" title={actionLabel}>
        {depth > 1 ? `Шаг исправления ${depth}: ` : ''}{actionLabel}
      </span>
    </div>
  )
}
