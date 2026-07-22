import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'

type RequestDialogFooterProps = {
  isPending: boolean
  isCreateDisabled: boolean
  disabledReason?: string | null
  onClose: () => void
  onSubmit: () => void
}

export function RequestDialogFooter({
  isPending,
  isCreateDisabled,
  disabledReason,
  onClose,
  onSubmit,
}: RequestDialogFooterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 px-5 py-4">
      <div className="min-w-0 flex-1">
        {disabledReason ? (
          <div className="inline-flex max-w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-800">
            {disabledReason}
          </div>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button onClick={onSubmit} disabled={isPending || isCreateDisabled} title={disabledReason ?? undefined}>
          <Check className="mr-2 h-4 w-4" />
          Создать заявку
        </Button>
      </div>
    </div>
  )
}
