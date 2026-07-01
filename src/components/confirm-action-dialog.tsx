import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { cn } from '@/lib/utils'

export type ConfirmActionDialogTone = 'danger' | 'warning'

type ConfirmActionDialogProps = {
  title: string
  itemName?: ReactNode
  description?: ReactNode
  warning?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmActionDialogTone
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmActionDialog({
  title,
  itemName,
  description,
  warning,
  confirmLabel = 'Удалить',
  cancelLabel = 'Отмена',
  tone = 'danger',
  onConfirm,
  onClose,
}: ConfirmActionDialogProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  const isDanger = tone === 'danger'

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[720px]"
      maxHeightClassName="max-h-[90vh]"
      overlayClassName="z-[160] bg-slate-950/35"
      panelRadiusClassName="rounded-lg"
      panelClassName="overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
        <button
          type="button"
          className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-5 px-6 py-6">
        <div
          className={cn(
            'rounded-md border px-5 py-4',
            isDanger
              ? 'border-red-200 bg-red-50 text-red-950'
              : 'border-amber-200 bg-amber-50 text-amber-950',
          )}
        >
          {itemName ? <div className="text-base font-semibold leading-relaxed">{itemName}</div> : null}
          {description ? <div className="mt-2 text-sm leading-relaxed">{description}</div> : null}
          {warning ? (
            <div className={cn('mt-3 text-sm leading-relaxed', isDanger ? 'text-red-700' : 'text-amber-700')}>
              {warning}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-5">
        <Button type="button" variant="outline" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={isDanger ? 'destructive' : 'default'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </LargeDialogShell>
  )
}
