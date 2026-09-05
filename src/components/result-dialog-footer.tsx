import { Check } from 'lucide-react'
import { BlockedActionHint, type BlockedActionHintAction } from '@/components/blocked-action-hint'
import { Button } from '@/components/ui/button'

export type ResultDialogFooterProps = {
  saveBlockReason: string | null
  isSaveDisabled: boolean
  saveBlockReasonVariant?: 'plain' | 'danger'
  blockReasonActionLabel?: string
  onBlockReasonAction?: () => void
  blockReasonActions?: BlockedActionHintAction[]
  onClose: () => void
  onSave: () => void
}

export function ResultDialogFooter({
  saveBlockReason,
  isSaveDisabled,
  saveBlockReasonVariant = 'plain',
  blockReasonActionLabel,
  onBlockReasonAction,
  blockReasonActions,
  onClose,
  onSave,
}: ResultDialogFooterProps) {
  const showDangerReason = Boolean(saveBlockReason && saveBlockReasonVariant === 'danger')

  return (
    <div className="flex items-end justify-between gap-4 border-t border-slate-200/80 px-5 py-4">
      <div className="min-h-5 text-sm text-slate-500">
        {saveBlockReason ? (
          <BlockedActionHint
            reason={showDangerReason ? `Сохранение заблокировано: ${saveBlockReason}` : saveBlockReason}
            actionLabel={blockReasonActionLabel}
            onAction={onBlockReasonAction}
            actions={blockReasonActions}
            tone={showDangerReason ? 'danger' : 'warning'}
          />
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Отмена
        </Button>
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
