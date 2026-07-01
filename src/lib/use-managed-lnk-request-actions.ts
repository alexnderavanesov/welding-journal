import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { useConfirmAction } from '@/lib/confirm-action-context'
import type { RowWithId, UseManagedLnkRequestActionsOptions } from '@/lib/managed-lnk-request-action-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export function useManagedLnkRequestActions({
  lnkRequestManagerOptions,
  managedLnkRequestName,
  managedLnkRequestNameDraft,
  lnkRequestCorrectionMutation,
  lnkRequestManagerMutation,
  setIsLnkRequestManagerOpen,
  setManagedLnkRequestName,
  setManagedLnkRequestNameDraft,
}: UseManagedLnkRequestActionsOptions) {
  const confirmAction = useConfirmAction()

  function clearLnkRequestFromRow(row: RowWithId, methodKey: WeldFieldKey) {
    lnkRequestCorrectionMutation.mutate({ record: row, methodKey, requestName: null })
  }

  function openLnkRequestManager() {
    const requestName = managedLnkRequestName || lnkRequestManagerOptions[0] || ''
    setManagedLnkRequestName(requestName)
    setManagedLnkRequestNameDraft(requestName)
    setIsLnkRequestManagerOpen(true)
  }

  function closeLnkRequestManager() {
    setIsLnkRequestManagerOpen(false)
  }

  function changeManagedLnkRequest(requestName: string) {
    setManagedLnkRequestName(requestName)
    setManagedLnkRequestNameDraft(requestName)
  }

  function renameManagedLnkRequest() {
    lnkRequestManagerMutation.mutate({
      action: 'rename',
      requestName: managedLnkRequestName,
      nextRequestName: managedLnkRequestNameDraft,
    })
  }

  async function deleteManagedLnkRequest() {
    const requestName = managedLnkRequestName.trim()
    if (!requestName) return
    const confirmed = await confirmAction({
      title: 'Удалить заявку ЛНК',
      itemName: requestName,
      description: 'Будут очищены связанные заявки, результаты, даты и заключения ЛНК для этой заявки.',
      warning: 'Это действие нельзя отменить.',
    })
    if (!confirmed) return
    lnkRequestManagerMutation.mutate({ action: 'delete', requestName })
  }

  async function clearManagedLnkRequestPosition(row: RowWithId, methodKey: WeldFieldKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) return
    const requestName = String(row[method.requestKey] ?? '').trim()
    const confirmed = await confirmAction({
      title: 'Очистить позицию заявки ЛНК',
      itemName: `${method.code} · ${String(row.joint ?? '-')} · ${requestName}`,
      description: 'Будут очищены заявка, результат, дата и заключение только для этой позиции.',
      warning: 'Остальные позиции заявки не изменятся.',
    })
    if (!confirmed) return
    clearLnkRequestFromRow(row, methodKey)
  }

  return {
    changeManagedLnkRequest,
    clearManagedLnkRequestPosition,
    closeLnkRequestManager,
    deleteManagedLnkRequest,
    openLnkRequestManager,
    renameManagedLnkRequest,
  }
}
