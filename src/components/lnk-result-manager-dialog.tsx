import { Check } from 'lucide-react'

import { DialogHelpNote } from '@/components/dialog-help-note'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import {
  LnkResultManagerEntry,
  type LnkResultChangeHintState,
  type LnkResultManagerEntryData,
  type LnkResultMethod,
  type LnkResultPreviewState,
} from '@/components/lnk-result-manager-entry'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
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
        <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Что редактируем</h3>
            <div className="space-y-3">
              <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                Выбрано стыков: <span className="font-semibold text-slate-900">{rows.length}</span>
              </div>

              <label className="block space-y-1.5 text-sm">
                <span className="text-[13px] font-medium leading-none text-slate-700">Метод контроля</span>
                <Select
                  value={methodKey}
                  onChange={(event) => onMethodChange(event.target.value as WeldFieldKey)}
                  disabled={methods.length === 0}
                >
                  <option value="">Все методы</option>
                  {methods.map((method) => (
                    <option key={method.requestKey} value={method.requestKey}>
                      {method.code}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </div>
          <DialogHelpNote>
            Замена меняет только результат и сохраняет существующее заключение. Наименование заключения редактируется отдельно у
            конкретного стыка. Удаление очищает результат, дату контроля и заключение.
          </DialogHelpNote>
        </section>

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
            <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
              {rows.length === 0
                ? 'Выберите стыки в окне добавления результата.'
                : 'По выбранным стыкам нет внесенных результатов для редактирования.'}
            </div>
          )}
        </section>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 px-5 py-4">
        <div className="text-sm text-slate-500">
          {pendingEntries.length > 0 ? (
            <span className="inline-flex rounded border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">
              Подготовлено изменений: {pendingEntries.length}
            </span>
          ) : (
            <span className="text-xs">Выберите новый результат, затем сохраните изменения.</span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onResetPendingChanges}
            disabled={pendingEntries.length === 0 || isResultReplacementPending}
          >
            Отменить изменения
          </Button>
          <Button onClick={onSaveChanges} disabled={pendingEntries.length === 0 || isResultReplacementPending}>
            <Check className="mr-2 h-4 w-4" />
            Сохранить изменения
          </Button>
        </div>
      </div>
    </LargeDialogShell>
  )
}
