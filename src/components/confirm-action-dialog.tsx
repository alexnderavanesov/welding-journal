import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { cn } from '@/lib/utils'

export type ConfirmActionDialogTone = 'danger' | 'warning' | 'neutral'

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
  confirmLabel,
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
        event.stopImmediatePropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  const isDanger = tone === 'danger'
  const resolvedConfirmLabel = confirmLabel ?? (isDanger ? 'Удалить' : 'Принять')

  return (
    <LargeDialogShell
      ariaLabel={title}
      maxWidthClassName="max-w-[720px]"
      maxHeightClassName="max-h-[90vh]"
      overlayClassName="z-[160] bg-slate-950/35"
      panelRadiusClassName="rounded-lg"
      panelClassName="overflow-hidden"
    >
      <div
        data-confirm-action-dialog="true"
        className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6 sm:py-5"
      >
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

      <div className="min-h-0 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 sm:py-6">
        <div
          className={cn(
            'min-w-0 rounded-md border px-3 py-3 sm:px-5 sm:py-4',
            isDanger
              ? 'border-red-200 bg-red-50 text-red-950'
              : tone === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-950'
                : 'border-slate-200 bg-slate-50 text-slate-950',
          )}
        >
          {itemName ? <div className="text-base font-semibold leading-relaxed">{itemName}</div> : null}
          {description ? <div className="mt-2 text-sm leading-relaxed">{description}</div> : null}
          {warning ? (
            <div className={cn('mt-3 text-sm leading-relaxed', isDanger ? 'text-red-700' : tone === 'warning' ? 'text-amber-700' : 'text-slate-600')}>
              {warning}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col-reverse justify-end gap-3 border-t border-slate-100 px-4 py-4 sm:flex-row sm:px-6 sm:py-5">
        <Button type="button" variant="outline" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={isDanger ? 'destructive' : 'default'} onClick={onConfirm}>
          {resolvedConfirmLabel}
        </Button>
      </div>
    </LargeDialogShell>
  )
}
