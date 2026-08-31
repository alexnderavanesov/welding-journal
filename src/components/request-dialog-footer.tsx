import { Check } from 'lucide-react'

import { BlockedActionHint } from '@/components/blocked-action-hint'
import { Button } from '@/components/ui/button'

type RequestDialogFooterProps = {
  isPending: boolean
  isCreateDisabled: boolean
  disabledReason?: string | null
  disabledReasonActionLabel?: string
  submitLabel?: string
  onDisabledReasonAction?: () => void
  onClose: () => void
  onSubmit: () => void
}

export function RequestDialogFooter({
  isPending,
  isCreateDisabled,
  disabledReason,
  disabledReasonActionLabel,
  submitLabel = 'Создать заявку',
  onDisabledReasonAction,
  onClose,
  onSubmit,
}: RequestDialogFooterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 px-5 py-3">
      <div className="min-w-0 flex-1">
        {disabledReason ? (
          <BlockedActionHint
            reason={disabledReason}
            actionLabel={disabledReasonActionLabel}
            onAction={onDisabledReasonAction}
          />
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button onClick={onSubmit} disabled={isPending || isCreateDisabled} title={disabledReason ?? undefined}>
          <Check className="mr-2 h-4 w-4" />
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
