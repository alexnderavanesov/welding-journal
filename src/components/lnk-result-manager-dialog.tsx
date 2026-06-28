import { DialogEmptyState } from '@/components/dialog-empty-state'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { LnkResultManagerFooter } from '@/components/lnk-result-manager-footer'
import {
  LnkResultManagerEntry,
  type LnkResultChangeHintState,
  type LnkResultManagerEntryData,
  type LnkResultMethod,
  type LnkResultPreviewState,
} from '@/components/lnk-result-manager-entry'
import { LnkResultManagerScopePanel } from '@/components/lnk-result-manager-scope-panel'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type LnkResultManagerDialogProps = {
  rows: WeldRow[]
  methods: LnkResultMethod[]
  entries: LnkResultManagerEntryData[]
  pendingEntries: LnkResultManagerEntryData[]
  methodKey: WeldFieldKey | ''
  conclusionDrafts: Record<string, string>
  pendingResultChanges: Record<string, string>
  preview: LnkResultPreviewState
  changeHint: LnkResultChangeHintState
  isResultCorrectionPending: boolean
  isResultReplacementPending: boolean
  isConclusionCorrectionPending: boolean
  onClose: () => void
  onMethodChange: (methodKey: WeldFieldKey | '') => void
  onConclusionDraftChange: (changeKey: string, value: string) => void
  onRenameConclusion: (row: WeldRow, methodKey: WeldFieldKey) => void
  onReplaceResult: (row: WeldRow, methodKey: WeldFieldKey, result: string) => void
  onClearResult: (row: WeldRow, methodKey: WeldFieldKey) => void
  onPreviewEnter: (preview: NonNullable<LnkResultPreviewState>) => void
  onPreviewLeave: (changeKey: string) => void
  onResetPendingChanges: () => void
  onSaveChanges: () => void
}

export function LnkResultManagerDialog({
  rows,
  methods,
  entries,
  pendingEntries,
  methodKey,
  conclusionDrafts,
  pendingResultChanges,
  preview,
  changeHint,
  isResultCorrectionPending,
  isResultReplacementPending,
  isConclusionCorrectionPending,
  onClose,
  onMethodChange,
  onConclusionDraftChange,
  onRenameConclusion,
  onReplaceResult,
  onClearResult,
  onPreviewEnter,
  onPreviewLeave,
  onResetPendingChanges,
  onSaveChanges,
}: LnkResultManagerDialogProps) {
  return (
    <LargeDialogShell>
      <DialogHeader
        title="Редактирование результатов ЛНК"
        subtitle="Замена результата или удаление результата вместе с датой и заключением."
        onClose={onClose}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-5 py-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <LnkResultManagerScopePanel
          selectedRowsCount={rows.length}
          methods={methods}
          methodKey={methodKey}
          onMethodChange={onMethodChange}
        />

        <section className="min-h-0 overflow-auto rounded-md border border-slate-200">
          {entries.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <LnkResultManagerEntry
                  key={entry.changeKey}
                  entry={entry}
                  conclusionDrafts={conclusionDrafts}
                  pendingResultChanges={pendingResultChanges}
                  preview={preview}
                  changeHint={changeHint}
                  isResultCorrectionPending={isResultCorrectionPending}
                  isResultReplacementPending={isResultReplacementPending}
                  isConclusionCorrectionPending={isConclusionCorrectionPending}
                  onConclusionDraftChange={onConclusionDraftChange}
                  onRenameConclusion={onRenameConclusion}
                  onReplaceResult={onReplaceResult}
                  onClearResult={onClearResult}
                  onPreviewEnter={onPreviewEnter}
                  onPreviewLeave={onPreviewLeave}
                />
              ))}
            </div>
          ) : (
            <DialogEmptyState>
              {rows.length === 0
                ? 'Выберите стыки в окне добавления результата.'
                : 'По выбранным стыкам нет внесенных результатов для редактирования.'}
            </DialogEmptyState>
          )}
        </section>
      </div>
      <LnkResultManagerFooter
        pendingEntriesCount={pendingEntries.length}
        isResultReplacementPending={isResultReplacementPending}
        onResetPendingChanges={onResetPendingChanges}
        onSaveChanges={onSaveChanges}
      />
    </LargeDialogShell>
  )
}
