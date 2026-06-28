import { Pencil } from 'lucide-react'

import { DialogHeader } from '@/components/dialog-header'
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
    <DialogHeader
      title={title}
      subtitle={`Заявка: ${requestName || '-'} · Выбрано: ${selectedCount}`}
      onClose={onClose}
      actions={
        <Button
          variant="outline"
          onClick={onOpenManager}
          disabled={managerDisabled}
          className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          <Pencil className="mr-2 h-4 w-4" />
          Редактировать результаты
        </Button>
      }
    />
  )
}
