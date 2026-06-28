import { Pencil, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

type ResultDialogHeaderProps = {
  title: string
  requestName: string
  selectedCount: number
  managerDisabled: boolean
  onOpenManager: () => void
  onClose: () => void
}

export function ResultDialogHeader({
  title,
  requestName,
  selectedCount,
  managerDisabled,
  onOpenManager,
  onClose,
}: ResultDialogHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          Заявка: {requestName || '-'} · Выбрано: {selectedCount}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={onOpenManager}
          disabled={managerDisabled}
          className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          <Pencil className="mr-2 h-4 w-4" />
          Редактировать результаты
        </Button>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
