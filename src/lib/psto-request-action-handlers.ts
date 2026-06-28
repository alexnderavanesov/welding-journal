import { getRequestNameFromNaming } from '@/lib/report-naming'
import { toggleNumberSetValue, toggleNumberSetValues } from '@/lib/report-ui-state'
import { canCreatePstoRequest } from '@/lib/psto-status'
import { defaultRequestNamingState } from '@/lib/request-naming-state'
import type { RowWithId, UsePstoReportActionsOptions } from '@/lib/psto-report-action-types'

export function createPstoRequestActionHandlers({
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
    setPstoRequestNaming(defaultRequestNamingState)
    setPstoRequestSearch('')
    setIsPstoRequestModalOpen(true)
  }

  function openCreatePstoRequestModalForRow(row: RowWithId) {
    if (!canCreatePstoRequest(row)) {
      setMessage('Заявка ПСТО для этого стыка уже создана')
      return
    }

    setSelectedHeatTreatmentIds(new Set([row.id]))
    setPstoRequestNaming(defaultRequestNamingState)
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

  function deleteManagedPstoRequest() {
    const requestName = managedPstoRequestName.trim()
    if (!requestName) return
    if (!confirm(`Удалить заявку ${requestName} и все связанные результаты ПСТО?`)) return
    pstoRequestManagerMutation.mutate({ action: 'delete', requestName })
  }

  function clearManagedPstoRequestPosition(record: RowWithId) {
    const requestName = String(record.pstoRequest ?? '').trim()
    if (!requestName) return
    if (!confirm(`Очистить заявку ${requestName} только для стыка ${String(record.joint ?? '-')}?`)) return
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
