import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type ResultDialogFooterProps = {
  saveBlockReason: string | null
  isSaveDisabled: boolean
  saveBlockReasonVariant?: 'plain' | 'danger'
  onClose: () => void
  onSave: () => void
  preview?: {
    label: string
    disabled: boolean
    onClick: () => void
  }
}

export function ResultDialogFooter({
  saveBlockReason,
  isSaveDisabled,
  saveBlockReasonVariant = 'plain',
  onClose,
  onSave,
  preview,
}: ResultDialogFooterProps) {
  const showDangerReason = Boolean(saveBlockReason && saveBlockReasonVariant === 'danger')

  return (
    <div className="flex items-end justify-between gap-4 border-t border-slate-200/80 px-5 py-4">
      <div className="min-h-5 text-sm text-slate-500">
        {saveBlockReason ? (
          showDangerReason ? (
            <span className="inline-block rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
              <span className="font-semibold">Сохранение заблокировано:</span> {saveBlockReason}
            </span>
          ) : (
            <span className="text-sm text-slate-500">{saveBlockReason}</span>
          )
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Отмена
        </Button>
        {preview ? (
          <Button variant="outline" onClick={preview.onClick} disabled={preview.disabled}>
            {preview.label}
          </Button>
        ) : null}
        <span title={saveBlockReason || 'Можно сохранить результат'}>
          <Button
            onClick={onSave}
            disabled={isSaveDisabled}
            className={
              isSaveDisabled
                ? 'pointer-events-none border border-slate-200 bg-slate-100 text-slate-400 shadow-none opacity-100'
                : ''
            }
          >
            <Check className="mr-2 h-4 w-4" />
            Сохранить результат
          </Button>
        </span>
      </div>
    </div>
  )
}
