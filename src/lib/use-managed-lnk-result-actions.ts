import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import {
  buildManagedLnkResultReplacementUpdates,
  getManagedLnkResultChangeHint,
} from '@/lib/managed-lnk-result-utils'
import type { RowWithId, UseManagedLnkResultActionsOptions } from '@/lib/managed-lnk-result-action-types'
import { getLnkResultNavigationEntries } from '@/lib/lnk-result-navigation'
import type { WeldFieldKey } from '@/lib/weld-fields'

export function useManagedLnkResultActions({
  isLnkRowsContextReady,
  lnkRows,
  selectedLnkResultRowIds,
  managedLnkConclusionDrafts,
  managedLnkPendingResultChanges,
  managedLnkPendingResultRows,
  lnkResultCorrectionMutation,
  lnkResultReplacementMutation,
  lnkConclusionCorrectionMutation,
  setMessage,
  setIsLnkResultModalOpen,
  setIsLnkResultManagerOpen,
  setManagedLnkResultMethodKey,
  setManagedLnkConclusionDrafts,
  setManagedLnkResultOrderIds,
  setManagedLnkResultTargetKey,
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
    setManagedLnkConclusionDrafts({})
    setManagedLnkResultOrderIds(null)
    setManagedLnkResultTargetKey('')
    setManagedLnkResultChangeHint(null)
    setManagedLnkPendingResultChanges({})
  }

  function openLnkResultManager(options: {
    rowIds?: number[] | null
    methodKey?: WeldFieldKey | ''
    targetKey?: string
  } = {}) {
    const rowIds = options.rowIds === undefined ? [...selectedLnkResultRowIds] : options.rowIds
    const selectedIds = rowIds === null ? null : new Set(rowIds)
    const selectedRows = selectedIds === null ? lnkRows : lnkRows.filter((row) => selectedIds.has(row.id))
    if (
      isLnkRowsContextReady &&
      (selectedRows.length === 0 || !selectedRows.some((row) => getLnkResultNavigationEntries(row).length > 0))
    ) {
      setMessage('Выберите один или несколько стыков для редактирования результатов')
      return
    }
    setManagedLnkResultMethodKey(options.methodKey ?? '')
    setManagedLnkConclusionDrafts({})
    setManagedLnkResultOrderIds(rowIds)
    setManagedLnkResultTargetKey(options.targetKey ?? '')
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
    setIsLnkResultModalOpen(false)
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
      delete next[getManagedLnkResultChangeKey(row.id, methodKey)]
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
