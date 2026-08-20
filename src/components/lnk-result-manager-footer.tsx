import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'

type LnkResultManagerFooterProps = {
  pendingEntriesCount: number
  isResultReplacementPending: boolean
  onResetPendingChanges: () => void
  onSaveChanges: () => void
}

export function LnkResultManagerFooter({
  pendingEntriesCount,
  isResultReplacementPending,
  onResetPendingChanges,
  onSaveChanges,
}: LnkResultManagerFooterProps) {
  return (
    <div className="flex min-h-[68px] flex-col items-stretch gap-3 border-t border-slate-200/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
      <div className="min-w-0 text-sm text-slate-500">
        {pendingEntriesCount > 0 ? (
          <span className="inline-flex rounded border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">
            Подготовлено изменений: {pendingEntriesCount}
          </span>
        ) : (
          <span className="text-xs">Выберите новый результат, затем сохраните изменения.</span>
        )}
      </div>
      <div className="grid shrink-0 gap-2 sm:flex sm:justify-end">
        <Button
          variant="outline"
          onClick={onResetPendingChanges}
          disabled={pendingEntriesCount === 0 || isResultReplacementPending}
          className="w-full sm:w-auto"
        >
          Отменить изменения
        </Button>
        <Button
          onClick={onSaveChanges}
          disabled={pendingEntriesCount === 0 || isResultReplacementPending}
          className="w-full sm:w-auto"
        >
          <Check className="mr-2 h-4 w-4" />
          Сохранить изменения
        </Button>
      </div>
    </div>
  )
}
