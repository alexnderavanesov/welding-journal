import { getRequestNameFromNaming } from '@/lib/report-naming'
import { toggleNumberSetValue, toggleNumberSetValues } from '@/lib/report-ui-state'
import { canCreatePstoRequest } from '@/lib/psto-status'
import type { RowWithId, UsePstoReportActionsOptions } from '@/lib/psto-report-action-types'

export function createPstoRequestActionHandlers({
  confirmAction,
  filteredAvailablePstoRequestRows,
  managedPstoRequestName,
  managedPstoRequestNameDraft,
  nextPstoRequestName,
  pstoRequestManagerOptions,
  pstoRequestNaming,
  selectedHeatTreatmentRows,
  pstoRequestCorrectionMutation,
  pstoRequestManagerMutation,
  pstoRequestMutation,
  defaultRequestNaming,
  setIsPstoRequestManagerOpen,
  setIsPstoRequestModalOpen,
  setManagedPstoRequestName,
  setManagedPstoRequestNameDraft,
  setMessage,
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

    pstoRequestMutation.mutate({ records: selectedHeatTreatmentRows, requestName, mode: 'create' })
  }

  function openCreatePstoRequestModal() {
    setSelectedHeatTreatmentIds(new Set())
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
    setPstoRequestNaming(defaultRequestNaming)
    setPstoRequestSearch(String(row.joint ?? row.line ?? ''))
    setIsPstoRequestModalOpen(true)
  }

  function closeCreatePstoRequestModal() {
    if (pstoRequestMutation.isPending) return
    setIsPstoRequestModalOpen(false)
  }

  function openPstoRequestManager() {
    const requestName = managedPstoRequestName || pstoRequestManagerOptions[0] || ''
    setManagedPstoRequestName(requestName)
    setManagedPstoRequestNameDraft(requestName)
    setIsPstoRequestManagerOpen(true)
  }

  function changeManagedPstoRequest(requestName: string) {
    setManagedPstoRequestName(requestName)
    setManagedPstoRequestNameDraft(requestName)
  }

  function renameManagedPstoRequest() {
    pstoRequestManagerMutation.mutate({
      action: 'rename',
      requestName: managedPstoRequestName,
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
    pstoRequestManagerMutation.mutate({ action: 'delete', requestName })
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
    pstoRequestMutation.mutate({ records: selectedHeatTreatmentRows, requestName, mode: 'create' })
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
