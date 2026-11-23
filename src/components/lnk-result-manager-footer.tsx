import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'

type LnkResultManagerFooterProps = {
  pendingEntriesCount: number
  isResultReplacementPending: boolean
  saveDisabledReason?: string
  onResetPendingChanges: () => void
  onSaveChanges: () => void
}

export function LnkResultManagerFooter({
  pendingEntriesCount,
  isResultReplacementPending,
  saveDisabledReason,
  onResetPendingChanges,
  onSaveChanges,
}: LnkResultManagerFooterProps) {
  return (
    <div className="flex flex-col items-stretch gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm text-slate-500">
        {pendingEntriesCount > 0 ? (
          <span className="inline-flex rounded border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">
            Подготовлено изменений результатов: {pendingEntriesCount}
          </span>
        ) : (
          <span className="text-xs">Нет изменений результатов. Дата и название сохраняются в блоке документа.</span>
        )}
      </div>
      {pendingEntriesCount > 0 ? <p className="text-xs text-slate-500">Будут сохранены все подготовленные изменения результатов в этом окне. Перед сохранением проверьте список подтверждения.</p> : null}
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
          disabled={pendingEntriesCount === 0 || isResultReplacementPending || Boolean(saveDisabledReason)}
          title={saveDisabledReason}
          className="w-full sm:w-auto"
        >
          <Check className="mr-2 h-4 w-4" />
          Сохранить изменения
        </Button>
      </div>
      {saveDisabledReason ? <p role="alert" className="text-xs text-amber-700">{saveDisabledReason}</p> : null}
    </div>
  )
}
