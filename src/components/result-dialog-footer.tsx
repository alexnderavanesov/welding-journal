import { Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { BlockedActionHint, type BlockedActionHintAction } from '@/components/blocked-action-hint'
import { Button } from '@/components/ui/button'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { useContainedDialogFocus } from '@/lib/use-contained-dialog-focus'

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
  const [details, setDetails] = useState<string | null>(null)
  const disabled = isSaveDisabled || isSaving || Boolean(saveBlockReason)
  const visibleReason = [
    saveBlockReason && (saveBlockReasonVariant === 'danger' ? `Сохранение заблокировано: ${saveBlockReason}` : saveBlockReason),
    saveError && `Не удалось сохранить: ${saveError}`,
  ].filter(Boolean).join('\n')
  const showDangerReason = Boolean(saveError || (saveBlockReason && saveBlockReasonVariant === 'danger'))
  // A long batch error must not push Save/Cancel outside the dialog. Keep its
  // full text available separately instead of scrolling the fixed action area.
  const preview = visibleReason.split('\n', 4).join('\n').slice(0, 400)
  const hasDetails = preview.length < visibleReason.length

  // Reserve space for ordinary validation + correction controls. A shorter
  // message must not move Save/Cancel; unusually wrapped content may grow.
  return (
    <div role="group" aria-label="Сохранение результата" className="grid min-h-44 shrink-0 grid-rows-[minmax(0,1fr)_auto] items-center gap-3 border-t border-slate-200/80 bg-slate-50/80 px-5 py-3 xl:min-h-32 xl:grid-cols-[minmax(0,1fr)_auto] xl:grid-rows-1">
      <div className="min-w-0 self-center text-sm text-slate-500">
        {visibleReason ? (
          <div role={saveError ? 'alert' : undefined}>
            <BlockedActionHint
              reason={hasDetails ? `${preview}…` : visibleReason}
              actionLabel={blockReasonActionLabel}
              onAction={onBlockReasonAction}
              actions={blockReasonActions}
              tone={showDangerReason ? 'danger' : 'warning'}
            />
            {hasDetails ? <button type="button" onClick={() => setDetails(visibleReason)} className="mt-1 text-xs font-medium text-sky-700 underline underline-offset-2">Показать сообщение полностью</button> : null}
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
              disabled={disabled}
              aria-busy={isSaving}
              className={
                disabled
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
      {details === visibleReason && hasDetails ? <SaveFeedbackDetails reason={visibleReason} onClose={() => setDetails(null)} /> : null}
    </div>
  )
}

function SaveFeedbackDetails({ reason, onClose }: { reason: string; onClose: () => void }) {
  const focus = useContainedDialogFocus(onClose)
  return <LargeDialogShell ariaLabel="Сообщение о сохранении" maxWidthClassName="max-w-[800px]" overlayClassName="z-[160] bg-slate-950/35" panelClassName="overflow-hidden">
    <div ref={focus} className="flex min-h-0 flex-col">
      <h2 className="shrink-0 border-b px-5 py-4 text-lg font-semibold">Сообщение о сохранении</h2>
      <div className="min-h-0 overflow-y-auto whitespace-pre-line break-words px-5 py-4 text-sm">{reason}</div>
      <div className="flex shrink-0 justify-end border-t px-5 py-3"><Button variant="outline" onClick={onClose}>Закрыть сообщение</Button></div>
    </div>
  </LargeDialogShell>
}
