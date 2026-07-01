import { LnkResultManagerActions } from '@/components/lnk-result-manager-actions'
import { LnkResultManagerSummary } from '@/components/lnk-result-manager-summary'
import { ResultManagerDocumentEditor } from '@/components/result-manager-document-editor'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type LnkResultMethod = (typeof LNK_METHODS)[number]

export type LnkResultManagerEntryData = {
  row: WeldRow
  method: LnkResultMethod
  changeKey: string
}

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
  changeHint: LnkResultChangeHintState
  isResultCorrectionPending: boolean
  isResultReplacementPending: boolean
  isConclusionCorrectionPending: boolean
  onConclusionDraftChange: (changeKey: string, value: string) => void
  onRenameConclusion: (row: WeldRow, methodKey: WeldFieldKey) => void
  onReplaceResult: (row: WeldRow, methodKey: WeldFieldKey, result: string) => void
  onClearResult: (row: WeldRow, methodKey: WeldFieldKey) => void
}

export function LnkResultManagerEntry({
  entry,
  conclusionDrafts,
  pendingResultChanges,
  changeHint,
  isResultCorrectionPending,
  isResultReplacementPending,
  isConclusionCorrectionPending,
  onConclusionDraftChange,
  onRenameConclusion,
  onReplaceResult,
  onClearResult,
}: LnkResultManagerEntryProps) {
  const { row, method, changeKey } = entry
  const currentResult = String(row[method.resultKey] ?? '').trim()
  const conclusionName = String(row[method.conclusionKey] ?? '').trim()
  const conclusionDate = String(row[method.conclusionDateKey] ?? '').trim()
  const conclusionDraft = conclusionDrafts[changeKey] ?? conclusionName
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
        <LnkResultManagerSummary
          row={row}
          methodCode={method.code}
          currentResult={currentResult}
          pendingResult={pendingResult}
          activeChangeHint={activeChangeHint}
          conclusionName={conclusionName}
          conclusionDate={conclusionDate}
        />
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
        currentResult={currentResult}
        pendingResult={pendingResult}
        isResultCorrectionPending={isResultCorrectionPending}
        isResultReplacementPending={isResultReplacementPending}
        onReplaceResult={onReplaceResult}
        onClearResult={onClearResult}
      />
    </div>
  )
}
