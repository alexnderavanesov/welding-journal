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
    <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 px-5 py-4">
      <div className="text-sm text-slate-500">
        {pendingEntriesCount > 0 ? (
          <span className="inline-flex rounded border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">
            Подготовлено изменений: {pendingEntriesCount}
          </span>
        ) : (
          <span className="text-xs">Выберите новый результат, затем сохраните изменения.</span>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={onResetPendingChanges}
          disabled={pendingEntriesCount === 0 || isResultReplacementPending}
        >
          Отменить изменения
        </Button>
        <Button onClick={onSaveChanges} disabled={pendingEntriesCount === 0 || isResultReplacementPending}>
          <Check className="mr-2 h-4 w-4" />
          Сохранить изменения
        </Button>
      </div>
    </div>
  )
}
