import { Check, Loader2 } from 'lucide-react'
import { BlockedActionHint, type BlockedActionHintAction } from '@/components/blocked-action-hint'
import { Button } from '@/components/ui/button'

export type ResultDialogFooterProps = {
  saveBlockReason: string | null
  isSaveDisabled: boolean
  isSaving?: boolean
  saveError?: string | null
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
  isSaving = false,
  saveError,
  saveBlockReasonVariant = 'plain',
  blockReasonActionLabel,
  onBlockReasonAction,
  blockReasonActions,
  onClose,
  onSave,
}: ResultDialogFooterProps) {
  const visibleReason = [
    saveBlockReason && (saveBlockReasonVariant === 'danger' ? `Сохранение заблокировано: ${saveBlockReason}` : saveBlockReason),
    saveError && `Не удалось сохранить: ${saveError}`,
  ].filter(Boolean).join('\n')
  const showDangerReason = Boolean(saveError || (saveBlockReason && saveBlockReasonVariant === 'danger'))

  return (
    <div role="group" aria-label="Сохранение результата" className="grid h-44 shrink-0 grid-rows-[minmax(0,1fr)_auto] items-center gap-3 border-t border-slate-200/80 bg-slate-50/80 px-5 py-3 xl:h-24 xl:grid-cols-[minmax(0,1fr)_auto] xl:grid-rows-1">
      <div className="max-h-full min-h-0 self-center overflow-y-auto overscroll-contain text-sm text-slate-500">
        {visibleReason ? (
          <div role={saveError ? 'alert' : undefined}>
            <BlockedActionHint
              reason={visibleReason}
              actionLabel={blockReasonActionLabel}
              onAction={onBlockReasonAction}
              actions={blockReasonActions}
              tone={showDangerReason ? 'danger' : 'warning'}
            />
          </div>
        ) : !isSaveDisabled && !isSaving ? (
          <p className="flex items-center gap-2 py-2 text-xs text-slate-500"><Check className="h-4 w-4 text-emerald-600" />Можно сохранить выбранные результаты.</p>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-3">
        <div className="ml-auto flex shrink-0 justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Отмена
          </Button>
          <span title={saveBlockReason || (isSaving ? 'Сохраняем…' : 'Можно сохранить результат')}>
            <Button
              onClick={onSave}
              disabled={isSaveDisabled || isSaving}
              aria-busy={isSaving}
              className={
                isSaveDisabled || isSaving
                  ? 'min-w-48 pointer-events-none border border-slate-200 bg-slate-100 text-slate-400 shadow-none opacity-100'
                  : 'min-w-48 border border-transparent'
              }
            >
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {isSaving ? 'Сохраняем…' : 'Сохранить результат'}
            </Button>
          </span>
        </div>
      </div>
    </div>
  )
}
