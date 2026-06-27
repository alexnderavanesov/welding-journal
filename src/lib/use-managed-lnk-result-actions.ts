import type { Dispatch, SetStateAction } from 'react'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import { filterLnkRowsByRequestName } from '@/lib/report-modal-rows'
import type { ManagedLnkResultChangeHintState, ManagedLnkResultPreviewState } from '@/lib/use-lnk-result-modal-state'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

type RowWithId = WeldInput & { id: number }

type ManagedLnkPendingResultRow = {
  row: RowWithId
  method: {
    requestKey: WeldFieldKey
  }
  changeKey: string
}

type MutationLike<TVariables> = {
  mutate: (variables: TVariables) => void
}

type UseManagedLnkResultActionsOptions = {
  lnkRows: WeldRow[]
  selectedLnkResultRowIds: Set<number>
  managedLnkConclusionDrafts: Record<string, string>
  managedLnkPendingResultChanges: Record<string, string>
  managedLnkPendingResultRows: ManagedLnkPendingResultRow[]
  lnkResultCorrectionMutation: MutationLike<{ record: RowWithId; methodKey: WeldFieldKey; result: string | null }>
  lnkResultReplacementMutation: MutationLike<{
    updates: Array<{ record: RowWithId; methodKey: WeldFieldKey; result: string }>
  }>
  lnkConclusionCorrectionMutation: MutationLike<{
    records: RowWithId[]
    methodKey: WeldFieldKey
    conclusionName: string
  }>
  setMessage: (value: string | null) => void
  setIsLnkResultManagerOpen: (value: boolean) => void
  setManagedLnkResultRequestName: (value: string) => void
  setManagedLnkResultMethodKey: Dispatch<SetStateAction<WeldFieldKey | ''>>
  setManagedLnkResultRequestSearch: (value: string) => void
  setManagedLnkConclusionDrafts: Dispatch<SetStateAction<Record<string, string>>>
  setManagedLnkResultOrderIds: Dispatch<SetStateAction<number[] | null>>
  setManagedLnkResultPreview: Dispatch<SetStateAction<ManagedLnkResultPreviewState>>
  setManagedLnkResultChangeHint: Dispatch<SetStateAction<ManagedLnkResultChangeHintState>>
  setManagedLnkPendingResultChanges: Dispatch<SetStateAction<Record<string, string>>>
}

export function useManagedLnkResultActions({
  lnkRows,
  selectedLnkResultRowIds,
  managedLnkConclusionDrafts,
  managedLnkPendingResultChanges,
  managedLnkPendingResultRows,
  lnkResultCorrectionMutation,
  lnkResultReplacementMutation,
  lnkConclusionCorrectionMutation,
  setMessage,
  setIsLnkResultManagerOpen,
  setManagedLnkResultRequestName,
  setManagedLnkResultMethodKey,
  setManagedLnkResultRequestSearch,
  setManagedLnkConclusionDrafts,
  setManagedLnkResultOrderIds,
  setManagedLnkResultPreview,
  setManagedLnkResultChangeHint,
  setManagedLnkPendingResultChanges,
}: UseManagedLnkResultActionsOptions) {
  function resetManagedLnkResultChanges() {
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
    setManagedLnkResultPreview(null)
  }

  function closeLnkResultManager() {
    setIsLnkResultManagerOpen(false)
    setManagedLnkResultOrderIds(null)
    setManagedLnkResultPreview(null)
    setManagedLnkResultChangeHint(null)
    setManagedLnkPendingResultChanges({})
  }

  function openLnkResultManager() {
    const selectedRows = lnkRows.filter((row) => selectedLnkResultRowIds.has(row.id))
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков для редактирования результатов')
      return
    }
    setManagedLnkResultRequestName('')
    setManagedLnkResultMethodKey('')
    setManagedLnkResultRequestSearch('')
    setManagedLnkResultOrderIds(selectedRows.map((row) => row.id))
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
    setManagedLnkResultPreview(null)
    setIsLnkResultManagerOpen(true)
  }

  function changeManagedLnkResultRequest(requestName: string) {
    const rowsForRequest = filterLnkRowsByRequestName(lnkRows, requestName)
    setManagedLnkResultRequestName(requestName)
    setManagedLnkResultMethodKey('')
    setManagedLnkResultOrderIds(rowsForRequest.map((row) => row.id))
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
    setManagedLnkResultPreview(null)
  }

  function changeManagedLnkResultMethod(nextMethodKey: WeldFieldKey | '') {
    setManagedLnkResultMethodKey(nextMethodKey)
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
    setManagedLnkResultPreview(null)
  }

  function changeManagedLnkConclusionDraft(changeKey: string, value: string) {
    setManagedLnkConclusionDrafts((current) => ({ ...current, [changeKey]: value }))
  }

  function renameManagedLnkConclusionForRow(row: RowWithId, methodKey: WeldFieldKey) {
    lnkConclusionCorrectionMutation.mutate({
      records: [row],
      methodKey,
      conclusionName: managedLnkConclusionDrafts[getManagedLnkResultChangeKey(row.id, methodKey)] ?? '',
    })
  }

  function replaceLnkResult(row: RowWithId, methodKey: WeldFieldKey, result: string) {
    const method = getLnkMethodByRequestKey(methodKey)
    const currentResult = method ? String(row[method.resultKey] ?? '').trim() : ''
    const changeKey = getManagedLnkResultChangeKey(row.id, methodKey)
    setManagedLnkResultPreview(null)
    if (currentResult && currentResult !== result) {
      setManagedLnkResultChangeHint({ changeKey, rowId: row.id, methodKey, from: currentResult, to: result })
      setManagedLnkPendingResultChanges((current) => ({ ...current, [changeKey]: result }))
    } else {
      setManagedLnkResultChangeHint(null)
      setManagedLnkPendingResultChanges((current) => {
        const next = { ...current }
        delete next[changeKey]
        return next
      })
    }
  }

  function saveManagedLnkResultChanges() {
    if (managedLnkPendingResultRows.length === 0) {
      setMessage('Нет изменений результата для сохранения')
      return
    }
    const updates = managedLnkPendingResultRows.map(({ row, method, changeKey }) => ({
      record: row,
      methodKey: method.requestKey,
      result: managedLnkPendingResultChanges[changeKey],
    }))
    lnkResultReplacementMutation.mutate({ updates })
  }

  function clearLnkResult(row: RowWithId, methodKey: WeldFieldKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) return
    setManagedLnkPendingResultChanges((current) => {
      const next = { ...current }
      delete next[row.id]
      return next
    })
    const confirmed = window.confirm(
      `Удалить результат ${method.code} по стыку ${String(row.joint ?? '-')}? Заключение и дата контроля по этому методу тоже будут очищены.`,
    )
    if (!confirmed) return
    setManagedLnkResultChangeHint(null)
    lnkResultCorrectionMutation.mutate({ record: row, methodKey, result: null })
  }

  function leaveManagedLnkPreview(changeKey: string) {
    setManagedLnkResultPreview((current) => (current?.changeKey === changeKey ? null : current))
  }

  return {
    changeManagedLnkConclusionDraft,
    changeManagedLnkResultMethod,
    changeManagedLnkResultRequest,
    clearLnkResult,
    closeLnkResultManager,
    leaveManagedLnkPreview,
    openLnkResultManager,
    renameManagedLnkConclusionForRow,
    replaceLnkResult,
    resetManagedLnkResultChanges,
    saveManagedLnkResultChanges,
  }
}
