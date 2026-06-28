import {
  JointFullMeta,
  JointTitleLine,
} from '@/components/joint-meta'
import { LnkResultManagerActions } from '@/components/lnk-result-manager-actions'
import { ResultManagerDocumentEditor } from '@/components/result-manager-document-editor'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { LNK_METHODS } from '@/lib/report-config'
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
            <JointFullMeta row={row} />
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
        <ResultManagerDocumentEditor
          value={conclusionDraft}
          placeholder="Наименование заключения для этого стыка"
          disabled={isConclusionCorrectionPending}
          canRename={
            !isConclusionCorrectionPending &&
            Boolean(conclusionDraft.trim()) &&
            conclusionDraft.trim() !== conclusionName
          }
          onChange={(value) => onConclusionDraftChange(changeKey, value)}
          onRename={() => onRenameConclusion(row, method.requestKey)}
        />
      </div>
      <LnkResultManagerActions
        row={row}
        method={method}
        changeKey={changeKey}
        currentResult={currentResult}
        pendingResult={pendingResult}
        isResultCorrectionPending={isResultCorrectionPending}
        isResultReplacementPending={isResultReplacementPending}
        onReplaceResult={onReplaceResult}
        onClearResult={onClearResult}
        onPreviewEnter={onPreviewEnter}
        onPreviewLeave={onPreviewLeave}
      />
    </div>
  )
}
