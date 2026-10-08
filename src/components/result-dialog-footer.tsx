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
    <div role="group" aria-label="Сохранение результата" className="grid h-44 shrink-0 grid-rows-[minmax(0,1fr)_auto] items-center gap-3 border-t border-slate-200/80 bg-slate-50/80 px-5 py-3 xl:h-24 xl:grid-cols-[minmax(0,1fr)_auto] xl:grid-rows-1">
      <div className="max-h-full min-h-0 self-center overflow-y-auto overscroll-contain text-sm text-slate-500">
        {saveBlockReason ? (
          <BlockedActionHint
            reason={showDangerReason ? `Сохранение заблокировано: ${saveBlockReason}` : saveBlockReason}
            actionLabel={blockReasonActionLabel}
            onAction={onBlockReasonAction}
            actions={blockReasonActions}
            tone={showDangerReason ? 'danger' : 'warning'}
          />
        ) : !isSaveDisabled ? (
          <p className="flex items-center gap-2 py-2 text-xs text-slate-500"><Check className="h-4 w-4 text-emerald-600" />Можно сохранить выбранные результаты.</p>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-3">
        <div className="ml-auto flex shrink-0 justify-end gap-2">
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
                  : 'border border-transparent'
              }
            >
              <Check className="mr-2 h-4 w-4" />
              Сохранить результат
            </Button>
          </span>
        </div>
      </div>
    </div>
  )
}
