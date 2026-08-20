import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { useConfirmAction } from '@/lib/confirm-action-context'
import type { RowWithId, UseManagedLnkRequestActionsOptions } from '@/lib/managed-lnk-request-action-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import {
  createRequestDocumentIdentity,
  findRequestDocumentIdentity,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

export function useManagedLnkRequestActions({
  lnkRequestManagerOptions,
  managedLnkRequestName,
  managedLnkRequestDate,
  managedLnkRequestNameDraft,
  lnkRequestCorrectionMutation,
  lnkRequestManagerMutation,
  setIsLnkRequestManagerOpen,
  setManagedLnkRequestName,
  setManagedLnkRequestDate,
  setManagedLnkRequestNameDraft,
}: UseManagedLnkRequestActionsOptions) {
  const confirmAction = useConfirmAction()

  function clearLnkRequestFromRow(row: RowWithId, methodKey: WeldFieldKey) {
    lnkRequestCorrectionMutation.mutate({ record: row, methodKey, requestName: null })
  }

  function openLnkRequestManager(requestNameOverride?: string, requestDateOverride?: string) {
    const exactOverride = createRequestDocumentIdentity(requestNameOverride, requestDateOverride)
    const request = exactOverride ?? findRequestDocumentIdentity(
      lnkRequestManagerOptions,
      managedLnkRequestName,
      managedLnkRequestDate,
    )
    setManagedLnkRequestName(request?.name ?? '')
    setManagedLnkRequestDate(request?.date ?? '')
    setManagedLnkRequestNameDraft(request?.name ?? '')
    setIsLnkRequestManagerOpen(true)
  }

  function closeLnkRequestManager() {
    setIsLnkRequestManagerOpen(false)
  }

  function changeManagedLnkRequest(request: RequestDocumentIdentity) {
    setManagedLnkRequestName(request.name)
    setManagedLnkRequestDate(request.date)
    setManagedLnkRequestNameDraft(request.name)
  }

  function renameManagedLnkRequest() {
    lnkRequestManagerMutation.mutate({
      action: 'rename',
      requestName: managedLnkRequestName,
      requestDate: managedLnkRequestDate,
      nextRequestName: managedLnkRequestNameDraft,
    })
  }

  async function deleteManagedLnkRequest() {
    const requestName = managedLnkRequestName.trim()
    if (!requestName) return
    const confirmed = await confirmAction({
      title: 'Удалить заявку ЛНК',
      itemName: requestName,
      description: 'Все ожидающие позиции будут исключены из заявки. Назначения видов НК сохранятся.',
      warning: 'Если хотя бы по одной позиции уже есть результат или заключение, удаление будет заблокировано.',
    })
    if (!confirmed) return
    lnkRequestManagerMutation.mutate({
      action: 'delete',
      requestName,
      requestDate: managedLnkRequestDate,
    })
  }

  async function clearManagedLnkRequestPosition(row: RowWithId, methodKey: WeldFieldKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) return
    const requestName = String(row[method.requestKey] ?? '').trim()
    const confirmed = await confirmAction({
      title: 'Исключить позицию из заявки ЛНК',
      itemName: `${method.code} · ${String(row.joint ?? '-')} · ${requestName}`,
      description: `Из заявки будет исключен только ${method.code} этого стыка. Назначение контроля сохранится.`,
      warning: 'Другие виды НК и остальные стыки заявки не изменятся. Выполненный контроль исключить нельзя.',
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
