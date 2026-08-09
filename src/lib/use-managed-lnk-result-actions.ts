import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import {
  buildManagedLnkResultReplacementUpdates,
  getManagedLnkResultChangeHint,
} from '@/lib/managed-lnk-result-utils'
import type { RowWithId, UseManagedLnkResultActionsOptions } from '@/lib/managed-lnk-result-action-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

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
  setManagedLnkResultMethodKey,
  setManagedLnkConclusionDrafts,
  setManagedLnkResultOrderIds,
  setManagedLnkResultChangeHint,
  setManagedLnkPendingResultChanges,
}: UseManagedLnkResultActionsOptions) {
  const confirmAction = useConfirmAction()

  function resetManagedLnkResultChanges() {
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
  }

  function closeLnkResultManager() {
    setIsLnkResultManagerOpen(false)
    setManagedLnkResultOrderIds(null)
    setManagedLnkResultChangeHint(null)
    setManagedLnkPendingResultChanges({})
  }

  function openLnkResultManager() {
    const selectedRows = lnkRows.filter((row) => selectedLnkResultRowIds.has(row.id))
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков для редактирования результатов')
      return
    }
    setManagedLnkResultMethodKey('')
    setManagedLnkResultOrderIds(selectedRows.map((row) => row.id))
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
    setIsLnkResultManagerOpen(true)
  }

  function changeManagedLnkResultMethod(nextMethodKey: WeldFieldKey | '') {
    setManagedLnkResultMethodKey(nextMethodKey)
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
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
    const changeKey = getManagedLnkResultChangeKey(row.id, methodKey)
    const changeHint = getManagedLnkResultChangeHint(row, methodKey, result)
    if (changeHint) {
      setManagedLnkResultChangeHint(changeHint)
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
    const updates = buildManagedLnkResultReplacementUpdates(managedLnkPendingResultRows, managedLnkPendingResultChanges)
    lnkResultReplacementMutation.mutate(
      { updates },
      { onSuccess: closeLnkResultManager },
    )
  }

  async function clearLnkResult(row: RowWithId, methodKey: WeldFieldKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) return
    setManagedLnkPendingResultChanges((current) => {
      const next = { ...current }
      delete next[row.id]
      return next
    })
    const confirmed = await confirmAction({
      title: 'Удалить результат ЛНК',
      itemName: `${method.code} · ${String(row.joint ?? '-')}`,
      description: 'Заключение и дата контроля по этому методу тоже будут очищены.',
      warning: 'Это действие нельзя отменить.',
    })
    if (!confirmed) return
    setManagedLnkResultChangeHint(null)
    lnkResultCorrectionMutation.mutate({ record: row, methodKey, result: null })
  }

  return {
    changeManagedLnkConclusionDraft,
    changeManagedLnkResultMethod,
    clearLnkResult,
    closeLnkResultManager,
    openLnkResultManager,
    renameManagedLnkConclusionForRow,
    replaceLnkResult,
    resetManagedLnkResultChanges,
    saveManagedLnkResultChanges,
  }
}
