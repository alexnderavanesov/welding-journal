import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

type RowWithId = WeldInput & { id: number }

type MutationLike<TVariables> = {
  mutate: (variables: TVariables) => void
}

type UseManagedLnkRequestActionsOptions = {
  lnkRequestManagerOptions: string[]
  managedLnkRequestName: string
  managedLnkRequestNameDraft: string
  lnkRequestCorrectionMutation: MutationLike<{ record: RowWithId; methodKey: WeldFieldKey; requestName: string | null }>
  lnkRequestManagerMutation: MutationLike<
    | { action: 'rename'; requestName: string; nextRequestName: string }
    | { action: 'delete'; requestName: string }
  >
  setIsLnkRequestManagerOpen: (value: boolean) => void
  setManagedLnkRequestName: (value: string) => void
  setManagedLnkRequestNameDraft: (value: string) => void
}

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

  function deleteManagedLnkRequest() {
    const requestName = managedLnkRequestName.trim()
    if (!requestName) return
    const confirmed = window.confirm(
      `Удалить заявку ${requestName}? Будут очищены связанные заявки, результаты, даты и заключения ЛНК для этой заявки.`,
    )
    if (!confirmed) return
    lnkRequestManagerMutation.mutate({ action: 'delete', requestName })
  }

  function clearManagedLnkRequestPosition(row: RowWithId, methodKey: WeldFieldKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) return
    const requestName = String(row[method.requestKey] ?? '').trim()
    const confirmed = window.confirm(
      `Очистить ${method.code} по стыку ${String(row.joint ?? '-')} из заявки ${requestName}? Будут очищены заявка, результат, дата и заключение только для этой позиции.`,
    )
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
