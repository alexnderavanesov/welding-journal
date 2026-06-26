import { Check, Pencil, X } from 'lucide-react'

import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointWeldDateMeta,
  MetaSeparator,
  OfficialityBadge,
} from '@/components/joint-meta'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isLnkRepairForbidden, getLnkRepairForbiddenReason } from '@/lib/lnk-result-rules'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import { getJointTitle } from '@/lib/report-ui-state'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkResultMethod = (typeof LNK_METHODS)[number]
type LnkResultManagerEntry = {
  row: WeldRow
  method: LnkResultMethod
  changeKey: string
}

type LnkResultPreviewState = {
  changeKey: string
  rowId: number
  methodKey: WeldFieldKey
  result: string
} | null

type LnkResultChangeHintState = {
  changeKey: string
  rowId: number
  methodKey: WeldFieldKey
  from: string
  to: string
} | null

type LnkResultManagerDialogProps = {
  rows: WeldRow[]
  methods: LnkResultMethod[]
  entries: LnkResultManagerEntry[]
  pendingEntries: LnkResultManagerEntry[]
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
      <div className="flex max-h-[92vh] w-full max-w-[1320px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Редактирование результатов ЛНК</h2>
            <p className="text-sm text-muted-foreground">
              Замена результата или удаление результата вместе с датой и заключением.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </Button>
        </div>

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
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
              Замена меняет только результат и сохраняет существующее заключение. Наименование заключения редактируется отдельно у
              конкретного стыка. Удаление очищает результат, дату контроля и заключение.
            </div>
          </section>

          <section className="min-h-0 overflow-auto rounded-md border border-slate-200">
            {entries.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {entries.map(({ row, method, changeKey }) => {
                  const currentResult = String(row[method.resultKey] ?? '').trim()
                  const conclusionName = String(row[method.conclusionKey] ?? '').trim()
                  const conclusionDate = String(row[method.conclusionDateKey] ?? '').trim()
                  const conclusionDraft = conclusionDrafts[changeKey] ?? conclusionName
                  const previewResult = preview?.changeKey === changeKey ? preview.result : ''
                  const pendingResult = pendingResultChanges[changeKey] ?? ''
                  const activeChangeHint =
                    pendingResult && pendingResult !== currentResult
                      ? { changeKey, rowId: row.id, methodKey: method.requestKey, from: currentResult, to: pendingResult }
                      : changeHint?.changeKey === changeKey
                        ? changeHint
                        : null

                  return (
                    <div key={changeKey} className="grid grid-cols-[minmax(520px,1fr)_minmax(260px,0.5fr)] gap-4 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="font-medium text-slate-900">{getJointTitle(row)}</span>
                          <OfficialityBadge row={row} compact />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>
                            <JointProjectSubtitleMeta row={row} />
                            <MetaSeparator />
                            <JointSpoolDiameterMeta row={row} />
                            <MetaSeparator />
                            <JointWeldDateMeta row={row} />
                          </span>
                          {activeChangeHint || (previewResult && previewResult !== currentResult) ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-medium text-slate-500">
                                {pendingResult && pendingResult !== currentResult ? 'Будет:' : 'Проверка:'}
                              </span>
                              <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getLnkResultBadgeClass(activeChangeHint?.from || currentResult)}`}>
                                {activeChangeHint?.from || currentResult || '-'}
                              </span>
                              <span className="px-0.5 text-sm font-bold leading-none text-slate-700">→</span>
                              <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getLnkResultBadgeClass(activeChangeHint?.to || previewResult)}`}>
                                {activeChangeHint?.to || previewResult}
                              </span>
                            </span>
                          ) : (
                            <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${currentResult ? getLnkResultBadgeClass(currentResult) : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                              Сейчас {method.code}: {currentResult || '-'}
                            </span>
                          )}
                        </div>
                        {conclusionName || conclusionDate ? (
                          <div className="mt-1 text-xs leading-5 text-slate-500">
                            <span className="font-medium text-slate-700">Заключение:</span>{' '}
                            <span className="break-words">{conclusionName || '-'}</span>
                            <span className="mx-1 text-slate-300">·</span>
                            <span className="font-medium text-slate-700">Дата:</span> {conclusionDate || '-'}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            value={conclusionDraft}
                            onChange={(event) => onConclusionDraftChange(changeKey, event.target.value)}
                            placeholder="Наименование заключения для этого стыка"
                            disabled={isConclusionCorrectionPending}
                            className="h-8 min-w-72 max-w-xl flex-1 bg-white text-xs"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onRenameConclusion(row, method.requestKey)}
                            disabled={
                              isConclusionCorrectionPending ||
                              !conclusionDraft.trim() ||
                              conclusionDraft.trim() === conclusionName
                            }
                            className="h-8"
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Переименовать
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap content-start justify-end gap-1.5">
                        <span className="w-full text-right text-xs font-medium text-slate-500">Изменить на:</span>
                        {LNK_RESULT_OPTIONS.map((option) => {
                          const disabledByRepairRule = option === 'ремонт' && isLnkRepairForbidden(row)
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                if (!disabledByRepairRule) onReplaceResult(row, method.requestKey, option)
                              }}
                              onMouseEnter={() => {
                                if (!disabledByRepairRule) onPreviewEnter({ changeKey, rowId: row.id, methodKey: method.requestKey, result: option })
                              }}
                              onMouseLeave={() => onPreviewLeave(changeKey)}
                              onFocus={() => {
                                if (!disabledByRepairRule) onPreviewEnter({ changeKey, rowId: row.id, methodKey: method.requestKey, result: option })
                              }}
                              onBlur={() => onPreviewLeave(changeKey)}
                              disabled={disabledByRepairRule || isResultCorrectionPending || isResultReplacementPending}
                              title={disabledByRepairRule ? getLnkRepairForbiddenReason(row) : undefined}
                              className={`rounded border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                disabledByRepairRule
                                  ? 'border-slate-200 bg-slate-50 text-slate-400'
                                  : (pendingResult || currentResult) === option
                                    ? getLnkResultBadgeClass(option)
                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {option}
                            </button>
                          )
                        })}
                        <button
                          type="button"
                          onClick={() => onClearResult(row, method.requestKey)}
                          disabled={!currentResult || isResultCorrectionPending || isResultReplacementPending}
                          className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          удалить результат
                        </button>
                      </div>
                    </div>
                  )
                })}
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
      </div>
    </div>
  )
}
