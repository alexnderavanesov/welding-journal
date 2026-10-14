import { createElement, useRef, useState } from 'react'
import { LnkResultChangesSummary } from '@/components/lnk-result-changes-summary'
import { describeLnkResultEdits } from './lnk-result-edit-plan'
import { buildLnkResultReplacementRows } from './lnk-result-correction-updates'
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
  managedLnkPendingResultChanges,
  managedLnkPendingResultRows,
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
  const originals = useRef(new Map<number, RowWithId>())
  const busy = useRef(false)
  const [isConfirmingResultChanges, setIsConfirmingResultChanges] = useState(false)
  // First-touch records, not refreshed query rows, define both old values and
  // optimistic versions. Hidden rows/methods must remain in this batch.
  const allManagedLnkPendingResultRows = Object.keys(managedLnkPendingResultChanges).flatMap(changeKey => {
    const [id, methodKey] = changeKey.split(':')
    const row = originals.current.get(Number(id))
      ?? managedLnkPendingResultRows.find(entry => entry.changeKey === changeKey)?.row
    const method = getLnkMethodByRequestKey(methodKey as WeldFieldKey)
    return row && method ? [{ row, method, changeKey }] : []
  })

  function resetManagedLnkResultChanges() {
    if (busy.current) return
    originals.current.clear()
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
  }

  function closeLnkResultManager() {
    if (busy.current) return
    originals.current.clear()
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
    allowEmpty?: boolean
  } = {}) {
    if (busy.current) return
    const rowIds = options.rowIds === undefined ? [...selectedLnkResultRowIds] : options.rowIds
    const selectedIds = rowIds === null ? null : new Set(rowIds)
    const selectedRows = selectedIds === null ? lnkRows : lnkRows.filter((row) => selectedIds.has(row.id))
    if (
      isLnkRowsContextReady &&
      !options.allowEmpty &&
      (selectedRows.length === 0 || !selectedRows.some((row) => getLnkResultNavigationEntries(row).length > 0))
    ) {
      setMessage('Выберите один или несколько стыков для редактирования результатов')
      return
    }
    setManagedLnkResultMethodKey(options.methodKey ?? '')
    originals.current.clear()
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
    setManagedLnkResultChangeHint(null)
  }

  function changeManagedLnkConclusionDraft(changeKey: string, value: string) {
    setManagedLnkConclusionDrafts((current) => ({ ...current, [changeKey]: value }))
  }

  function renameManagedLnkConclusionForRow(
    row: RowWithId,
    methodKey: WeldFieldKey,
    conclusionName: string,
    conclusionDate?: string,
  ) {
    if (Object.keys(managedLnkPendingResultChanges).length > 0 || busy.current) {
      setMessage('Сначала сохраните или сбросьте изменения результатов.')
      return
    }
    lnkConclusionCorrectionMutation.mutate({
      records: [row],
      methodKey,
      conclusionName,
      ...(conclusionDate !== undefined ? { conclusionDate } : {}),
    })
  }

  function replaceLnkResult(row: RowWithId, methodKey: WeldFieldKey, result: string) {
    if (busy.current) return
    if (!originals.current.has(row.id)) originals.current.set(row.id, structuredClone(row))
    row = originals.current.get(row.id)!
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

  async function saveManagedLnkResultChanges() {
    if (busy.current) return
    if (Object.keys(managedLnkPendingResultChanges).length === 0) {
      setMessage('Нет изменений результата для сохранения')
      return
    }
    if (allManagedLnkPendingResultRows.length !== Object.keys(managedLnkPendingResultChanges).length) {
      setMessage('Исходные данные результата недоступны. Сбросьте изменения и откройте редактор заново.')
      return
    }
    const updates = structuredClone(buildManagedLnkResultReplacementUpdates(allManagedLnkPendingResultRows, managedLnkPendingResultChanges))
    try { buildLnkResultReplacementRows({ updates }) }
    catch (error) { setMessage((error as Error).message); return }
    busy.current = true
    setIsConfirmingResultChanges(true)
    let submitted = false
    try {
      const confirmed = await confirmAction({
        title: 'Подтвердить изменения результатов',
        tone: 'neutral',
        description: createElement(LnkResultChangesSummary, { changes: describeLnkResultEdits(updates) }),
        confirmLabel: 'Применить изменения', cancelLabel: 'Вернуться к редактированию',
      })
      if (!confirmed) return
      submitted = true
      lnkResultReplacementMutation.mutate({ updates }, {
        onSuccess: () => { busy.current = false; closeLnkResultManager() },
        onSettled: () => { busy.current = false; setIsConfirmingResultChanges(false) },
      })
    } finally {
      if (!submitted) {
        busy.current = false
        setIsConfirmingResultChanges(false)
      }
    }
  }

  function clearLnkResult(row: RowWithId, methodKey: WeldFieldKey) {
    if (busy.current) return
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) return
    if (!originals.current.has(row.id)) originals.current.set(row.id, structuredClone(row))
    setManagedLnkPendingResultChanges(current => ({ ...current, [getManagedLnkResultChangeKey(row.id, methodKey)]: null }))
    setManagedLnkResultChangeHint(null)
  }

  return {
    allManagedLnkPendingResultRows,
    isConfirmingResultChanges,
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
