import { formatDateInputValue } from '@/lib/date-format'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import { toggleNumberSetValue, toggleNumberSetValues } from '@/lib/report-ui-state'
import { canCreatePstoRequest } from '@/lib/psto-status'
import type { RowWithId, UsePstoReportActionsOptions } from '@/lib/psto-report-action-types'
import { findRequestDocumentIdentity, type RequestDocumentIdentity } from '@/lib/request-document-identity'

export function createPstoRequestActionHandlers({
  confirmAction,
  filteredAvailablePstoRequestRows,
  managedPstoRequestName,
  managedPstoRequestDate,
  managedPstoRequestNameDraft,
  nextPstoRequestName,
  pstoRequestManagerOptions,
  pstoRequestDate,
  pstoRequestNaming,
  selectedHeatTreatmentRows,
  pstoRequestCorrectionMutation,
  pstoRequestManagerMutation,
  pstoRequestMutation,
  defaultRequestNaming,
  setIsPstoRequestManagerOpen,
  setIsPstoRequestModalOpen,
  setManagedPstoRequestName,
  setManagedPstoRequestDate,
  setManagedPstoRequestNameDraft,
  setMessage,
  setPstoRequestDate,
  setPstoRequestNaming,
  setPstoRequestSearch,
  setSelectedHeatTreatmentIds,
}: UsePstoReportActionsOptions) {
  function handleCreatePstoRequest() {
    if (selectedHeatTreatmentRows.length === 0) {
      setMessage('Выберите один или несколько стыков для заявки ПСТО')
      return
    }

    const requestName = getRequestNameFromNaming(pstoRequestNaming, nextPstoRequestName)
    if (!requestName) {
      setMessage('Укажите пользовательское наименование заявки ПСТО')
      return
    }

    pstoRequestMutation.mutate({
      records: selectedHeatTreatmentRows,
      requestName,
      requestDate: pstoRequestDate,
      mode: 'create',
      useSystemName: pstoRequestNaming.mode === 'system',
    })
  }

  function openCreatePstoRequestModal() {
    setSelectedHeatTreatmentIds(new Set())
    setPstoRequestDate(formatDateInputValue(new Date()))
    setPstoRequestNaming(defaultRequestNaming)
    setPstoRequestSearch('')
    setIsPstoRequestModalOpen(true)
  }

  function openCreatePstoRequestModalForRow(row: RowWithId) {
    if (!canCreatePstoRequest(row)) {
      setMessage('Заявка ПСТО для этого стыка уже создана')
      return
    }

    setSelectedHeatTreatmentIds(new Set([row.id]))
    setPstoRequestDate(formatDateInputValue(new Date()))
    setPstoRequestNaming(defaultRequestNaming)
    setPstoRequestSearch(String(row.joint ?? row.line ?? ''))
    setIsPstoRequestModalOpen(true)
  }

  function closeCreatePstoRequestModal() {
    if (pstoRequestMutation.isPending) return
    setIsPstoRequestModalOpen(false)
  }

  function openPstoRequestManager(requestNameOverride?: string, requestDateOverride?: string) {
    const request = findRequestDocumentIdentity(
      pstoRequestManagerOptions,
      requestNameOverride || managedPstoRequestName,
      requestDateOverride || managedPstoRequestDate,
    )
    setManagedPstoRequestName(request?.name ?? '')
    setManagedPstoRequestDate(request?.date ?? '')
    setManagedPstoRequestNameDraft(request?.name ?? '')
    setIsPstoRequestManagerOpen(true)
  }

  function changeManagedPstoRequest(request: RequestDocumentIdentity) {
    setManagedPstoRequestName(request.name)
    setManagedPstoRequestDate(request.date)
    setManagedPstoRequestNameDraft(request.name)
  }

  function renameManagedPstoRequest() {
    pstoRequestManagerMutation.mutate({
      action: 'rename',
      requestName: managedPstoRequestName,
      requestDate: managedPstoRequestDate,
      nextRequestName: managedPstoRequestNameDraft,
    })
  }

  async function deleteManagedPstoRequest() {
    const requestName = managedPstoRequestName.trim()
    if (!requestName) return
    const confirmed = await confirmAction({
      title: 'Удалить заявку ПСТО',
      itemName: requestName,
      description: 'Будут удалены заявка ПСТО и все связанные результаты ПСТО.',
      warning: 'Это действие нельзя отменить.',
    })
    if (!confirmed) return
    pstoRequestManagerMutation.mutate({
      action: 'delete',
      requestName,
      requestDate: managedPstoRequestDate,
    })
  }

  async function clearManagedPstoRequestPosition(record: RowWithId) {
    const requestName = String(record.pstoRequest ?? '').trim()
    if (!requestName) return
    const confirmed = await confirmAction({
      title: 'Очистить позицию заявки ПСТО',
      itemName: `${String(record.joint ?? '-')} · ${requestName}`,
      description: 'Будет очищена заявка ПСТО только для этого стыка.',
      warning: 'Остальные позиции заявки не изменятся.',
    })
    if (!confirmed) return
    pstoRequestCorrectionMutation.mutate({ record })
  }

  function submitCreatePstoRequest() {
    const requestName = getRequestNameFromNaming(pstoRequestNaming, nextPstoRequestName)
    if (!requestName) {
      setMessage('Укажите пользовательское наименование заявки ПСТО')
      return
    }
    pstoRequestMutation.mutate({
      records: selectedHeatTreatmentRows,
      requestName,
      requestDate: pstoRequestDate,
      mode: 'create',
      useSystemName: pstoRequestNaming.mode === 'system',
    })
  }

  function togglePstoRequestRow(rowId: number) {
    setSelectedHeatTreatmentIds((current) => toggleNumberSetValue(current, rowId))
  }

  function toggleAllPstoRequestRows() {
    setSelectedHeatTreatmentIds((current) =>
      toggleNumberSetValues(current, filteredAvailablePstoRequestRows.map((row) => row.id)),
    )
  }

  return {
    changeManagedPstoRequest,
    clearManagedPstoRequestPosition,
    closeCreatePstoRequestModal,
    deleteManagedPstoRequest,
    handleCreatePstoRequest,
    openCreatePstoRequestModal,
    openCreatePstoRequestModalForRow,
    openPstoRequestManager,
    renameManagedPstoRequest,
    submitCreatePstoRequest,
    toggleAllPstoRequestRows,
    togglePstoRequestRow,
  }
}
