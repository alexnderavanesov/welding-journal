import type { Dispatch, SetStateAction } from 'react'
import { PSTO_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import {
  createDefaultPstoResultDraft,
  type PstoResultDraftState,
} from '@/lib/report-draft-state'
import {
  canSelectPstoResultRow,
  rowBelongsToPstoRequest,
} from '@/lib/report-modal-rows'
import {
  getRequestNameFromNaming,
} from '@/lib/report-naming'
import {
  buildManagedPstoDiagramDrafts,
  getPstoResultRequestName,
} from '@/lib/psto-report-action-utils'
import {
  toggleNumberSetValue,
  toggleNumberSetValues,
} from '@/lib/report-ui-state'
import { canCreatePstoRequest } from '@/lib/psto-status'
import {
  defaultRequestNamingState,
  type RequestNamingState,
} from '@/lib/request-naming-state'
import type { WeldInput } from '@/lib/weld-fields'

type RowWithId = WeldInput & { id: number }

type MutationLike<TVariables> = {
  isPending: boolean
  mutate: (variables: TVariables) => void
}

type PstoRequestVariables = {
  records: RowWithId[]
  requestName: string
  mode?: 'create' | 'edit'
}

type PstoRequestManagerVariables = {
  requestName: string
  nextRequestName?: string
  action: 'rename' | 'delete'
}

type PstoRequestCorrectionVariables = {
  record: RowWithId
}

type PstoResultVariables = {
  records: RowWithId[]
  pstoDate: string
  result: string
  diagramName: string
  rows: RowWithId[]
}

type PstoResultCorrectionVariables = {
  record: RowWithId
  action: 'renameDiagram' | 'deleteResult'
  diagramName?: string
}

type UsePstoReportActionsOptions = {
  rows: RowWithId[]
  heatTreatmentRows: RowWithId[]
  filteredAvailablePstoRequestRows: RowWithId[]
  filteredPstoResultRows: RowWithId[]
  managedPstoDiagramDrafts: Record<number, string>
  managedPstoRequestName: string
  managedPstoRequestNameDraft: string
  nextPstoDiagramName: string
  nextPstoRequestName: string
  pstoRequestManagerOptions: string[]
  pstoRequestNaming: RequestNamingState
  pstoResultDraft: PstoResultDraftState
  pstoResultSaveBlockReason: string | null
  selectedHeatTreatmentRows: RowWithId[]
  selectedPstoResultRows: RowWithId[]
  pstoRequestCorrectionMutation: MutationLike<PstoRequestCorrectionVariables>
  pstoRequestManagerMutation: MutationLike<PstoRequestManagerVariables>
  pstoRequestMutation: MutationLike<PstoRequestVariables>
  pstoResultCorrectionMutation: MutationLike<PstoResultCorrectionVariables>
  pstoResultMutation: MutationLike<PstoResultVariables>
  setIsPstoRequestManagerOpen: (value: boolean) => void
  setIsPstoRequestModalOpen: (value: boolean) => void
  setIsPstoResultManagerOpen: (value: boolean) => void
  setIsPstoResultModalOpen: (value: boolean) => void
  setManagedPstoDiagramDrafts: Dispatch<SetStateAction<Record<number, string>>>
  setManagedPstoRequestName: (value: string) => void
  setManagedPstoRequestNameDraft: (value: string) => void
  setMessage: (value: string) => void
  setPstoRequestNaming: (value: RequestNamingState) => void
  setPstoRequestSearch: (value: string) => void
  setPstoResultDraft: Dispatch<SetStateAction<PstoResultDraftState>>
  setPstoResultRequestSearch: (value: string) => void
  setSelectedHeatTreatmentIds: Dispatch<SetStateAction<Set<number>>>
}

export function usePstoReportActions({
  rows,
  heatTreatmentRows,
  filteredAvailablePstoRequestRows,
  filteredPstoResultRows,
  managedPstoDiagramDrafts,
  managedPstoRequestName,
  managedPstoRequestNameDraft,
  nextPstoDiagramName,
  nextPstoRequestName,
  pstoRequestManagerOptions,
  pstoRequestNaming,
  pstoResultDraft,
  pstoResultSaveBlockReason,
  selectedHeatTreatmentRows,
  selectedPstoResultRows,
  pstoRequestCorrectionMutation,
  pstoRequestManagerMutation,
  pstoRequestMutation,
  pstoResultCorrectionMutation,
  pstoResultMutation,
  setIsPstoRequestManagerOpen,
  setIsPstoRequestModalOpen,
  setIsPstoResultManagerOpen,
  setIsPstoResultModalOpen,
  setManagedPstoDiagramDrafts,
  setManagedPstoRequestName,
  setManagedPstoRequestNameDraft,
  setMessage,
  setPstoRequestNaming,
  setPstoRequestSearch,
  setPstoResultDraft,
  setPstoResultRequestSearch,
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

  function openAddPstoResultModal() {
    setPstoResultRequestSearch('')
    setPstoResultDraft(createDefaultPstoResultDraft())
    setIsPstoResultModalOpen(true)
  }

  function openAddPstoResultModalForRow(row: RowWithId) {
    const requestName = String(row.pstoRequest ?? '').trim()
    if (!requestName) {
      setMessage('Сначала создайте заявку ПСТО для этого стыка')
      return
    }

    setPstoResultDraft({
      ...createDefaultPstoResultDraft(),
      requestName,
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
    })
    setPstoResultRequestSearch(requestName)
    setIsPstoResultModalOpen(true)
  }

  function closeAddPstoResultModal() {
    if (pstoResultMutation.isPending) return
    setPstoResultRequestSearch('')
    setIsPstoResultModalOpen(false)
  }

  function openPstoResultManager() {
    const selectedRows = heatTreatmentRows.filter((row) => pstoResultDraft.rowIds.has(row.id))
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков для редактирования результатов ПСТО')
      return
    }
    setManagedPstoDiagramDrafts(buildManagedPstoDiagramDrafts(selectedRows))
    setIsPstoResultManagerOpen(true)
  }

  function renameManagedPstoDiagram(row: RowWithId) {
    pstoResultCorrectionMutation.mutate({
      record: row,
      action: 'renameDiagram',
      diagramName: managedPstoDiagramDrafts[row.id] ?? '',
    })
  }

  function deleteManagedPstoResult(row: RowWithId) {
    if (!confirm(`Удалить результат ПСТО для стыка ${String(row.joint ?? '-')}?`)) return
    pstoResultCorrectionMutation.mutate({ record: row, action: 'deleteResult' })
  }

  function changePstoResultRequest(requestName: string) {
    setPstoResultDraft((current) => {
      if (!requestName) return { ...current, requestName: '' }
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = heatTreatmentRows.find((candidate) => candidate.id === id)
          return row ? rowBelongsToPstoRequest(row, requestName) : false
        }),
      )
      return { ...current, requestName, rowIds }
    })
  }

  function togglePstoResultRow(rowId: number) {
    const row = filteredPstoResultRows.find((candidate) => candidate.id === rowId)
    if (!row || !canSelectPstoResultRow(row, pstoResultDraft.requestName)) return

    setPstoResultDraft((current) => {
      const rowIds = new Set(current.rowIds)
      if (rowIds.has(rowId)) {
        rowIds.delete(rowId)
      } else {
        rowIds.add(rowId)
      }
      const selectedRows = heatTreatmentRows.filter((candidate) => rowIds.has(candidate.id))
      const requestName = getPstoResultRequestName(current.requestName, selectedRows)
      return { ...current, requestName, rowIds }
    })
  }

  function toggleAllPstoResultRows() {
    setPstoResultDraft((current) => {
      const filteredIds = new Set(
        filteredPstoResultRows.filter((row) => canSelectPstoResultRow(row, current.requestName)).map((row) => row.id),
      )
      if (filteredIds.size === 0) return current
      const allSelected = [...filteredIds].every((id) => current.rowIds.has(id))
      const rowIds = allSelected
        ? new Set([...current.rowIds].filter((id) => !filteredIds.has(id)))
        : new Set([...current.rowIds, ...filteredIds])
      const selectedRows = heatTreatmentRows.filter((row) => rowIds.has(row.id))
      const requestName = getPstoResultRequestName(current.requestName, selectedRows)
      return { ...current, requestName, rowIds }
    })
  }

  function togglePstoRequestRow(rowId: number) {
    setSelectedHeatTreatmentIds((current) => toggleNumberSetValue(current, rowId))
  }

  function toggleAllPstoRequestRows() {
    setSelectedHeatTreatmentIds((current) => toggleNumberSetValues(current, filteredAvailablePstoRequestRows.map((row) => row.id)))
  }

  function handleAddPstoResult() {
    if (pstoResultSaveBlockReason) {
      setMessage(pstoResultSaveBlockReason)
      return
    }
    if (!pstoResultDraft.requestName) {
      setMessage('Выберите заявку ПСТО')
      return
    }
    if (selectedPstoResultRows.length === 0) {
      setMessage('Выберите один или несколько стыков')
      return
    }
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && pstoResultDraft.result !== 'проведено') {
      setMessage('Выберите результат ПСТО')
      return
    }
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && !pstoResultDraft.pstoDate) {
      setMessage('Укажите дату ПСТО')
      return
    }
    const diagramName =
      pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE
        ? ''
        : getRequestNameFromNaming(pstoResultDraft.diagramNaming, nextPstoDiagramName)
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && !diagramName) {
      setMessage('Укажите наименование диаграммы термообработки')
      return
    }

    pstoResultMutation.mutate({
      records: selectedPstoResultRows,
      pstoDate: pstoResultDraft.pstoDate,
      result: pstoResultDraft.result,
      diagramName,
      rows,
    })
  }

  return {
    changeManagedPstoRequest,
    changePstoResultRequest,
    clearManagedPstoRequestPosition,
    closeAddPstoResultModal,
    closeCreatePstoRequestModal,
    deleteManagedPstoRequest,
    deleteManagedPstoResult,
    handleAddPstoResult,
    handleCreatePstoRequest,
    openAddPstoResultModal,
    openAddPstoResultModalForRow,
    openCreatePstoRequestModal,
    openCreatePstoRequestModalForRow,
    openPstoRequestManager,
    openPstoResultManager,
    renameManagedPstoDiagram,
    renameManagedPstoRequest,
    submitCreatePstoRequest,
    toggleAllPstoRequestRows,
    toggleAllPstoResultRows,
    togglePstoRequestRow,
    togglePstoResultRow,
  }
}
