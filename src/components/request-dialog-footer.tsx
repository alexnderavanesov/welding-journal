import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'

type RequestDialogFooterProps = {
  isPending: boolean
  isCreateDisabled: boolean
  onClose: () => void
  onSubmit: () => void
}

export function RequestDialogFooter({
  isPending,
  isCreateDisabled,
  onClose,
  onSubmit,
}: RequestDialogFooterProps) {
  return (
    <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
      <Button variant="outline" onClick={onClose}>
        Отмена
      </Button>
      <Button onClick={onSubmit} disabled={isPending || isCreateDisabled}>
        <Check className="mr-2 h-4 w-4" />
        Создать заявку
      </Button>
    </div>
  )
}
