import { Pencil } from 'lucide-react'

import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointTitleLine,
  JointWeldDateMeta,
  MetaSeparator,
} from '@/components/joint-meta'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isLnkRepairForbidden, getLnkRepairForbiddenReason } from '@/lib/lnk-result-rules'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type LnkResultMethod = (typeof LNK_METHODS)[number]

export type LnkResultManagerEntryData = {
  row: WeldRow
  method: LnkResultMethod
  changeKey: string
}

export type LnkResultPreviewState = {
  changeKey: string
  rowId: number
  methodKey: WeldFieldKey
  result: string
} | null

export type LnkResultChangeHintState = {
  changeKey: string
  rowId: number
  methodKey: WeldFieldKey
  from: string
  to: string
} | null

type LnkResultManagerEntryProps = {
  entry: LnkResultManagerEntryData
  conclusionDrafts: Record<string, string>
  pendingResultChanges: Record<string, string>
  preview: LnkResultPreviewState
  changeHint: LnkResultChangeHintState
  isResultCorrectionPending: boolean
  isResultReplacementPending: boolean
  isConclusionCorrectionPending: boolean
  onConclusionDraftChange: (changeKey: string, value: string) => void
  onRenameConclusion: (row: WeldRow, methodKey: WeldFieldKey) => void
  onReplaceResult: (row: WeldRow, methodKey: WeldFieldKey, result: string) => void
  onClearResult: (row: WeldRow, methodKey: WeldFieldKey) => void
  onPreviewEnter: (preview: NonNullable<LnkResultPreviewState>) => void
  onPreviewLeave: (changeKey: string) => void
}

export function LnkResultManagerEntry({
  entry,
  conclusionDrafts,
  pendingResultChanges,
  preview,
  changeHint,
  isResultCorrectionPending,
  isResultReplacementPending,
  isConclusionCorrectionPending,
  onConclusionDraftChange,
  onRenameConclusion,
  onReplaceResult,
  onClearResult,
  onPreviewEnter,
  onPreviewLeave,
}: LnkResultManagerEntryProps) {
  const { row, method, changeKey } = entry
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
    <div className="grid grid-cols-[minmax(520px,1fr)_minmax(260px,0.5fr)] gap-4 px-4 py-3 text-sm">
      <div className="min-w-0">
        <JointTitleLine row={row} />
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
}
