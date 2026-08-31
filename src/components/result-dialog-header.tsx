import { ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'

import { DialogHeader } from '@/components/dialog-header'
import { Button } from '@/components/ui/button'

type ResultDialogHeaderProps = {
  title: string
  requestName: string
  selectedCount: number
  managerDisabled: boolean
  managerDisabledReason?: string
  onOpenManager: () => void
  onClose: () => void
  stageControl?: ReactNode
}

export function ResultDialogHeader({
  title,
  requestName,
  selectedCount,
  managerDisabled,
  managerDisabledReason,
  onOpenManager,
  onClose,
  stageControl,
}: ResultDialogHeaderProps) {
  return (
    <DialogHeader
      title={title}
      subtitle={`Заявка: ${requestName || '-'} · Выбрано: ${selectedCount}`}
      onClose={onClose}
      actions={
        <div className="flex items-center gap-2">
          {stageControl}
          <span className="inline-flex" title={managerDisabled ? managerDisabledReason : undefined}>
            <Button
              variant="outline"
              onClick={onOpenManager}
              disabled={managerDisabled}
              className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:pointer-events-none disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <ListFilter className="mr-2 h-4 w-4" />
              Все результаты
            </Button>
          </span>
        </div>
      }
    />
  )
}
