import { createDefaultPstoResultDraft } from '@/lib/report-draft-state'
import { canSelectPstoResultRow } from '@/lib/report-modal-rows'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import {
  buildManagedPstoDiagramDrafts,
  resolvePstoResultDraftAfterBulkToggle,
  resolvePstoResultDraftAfterRequestChange,
  resolvePstoResultDraftAfterRowToggle,
} from '@/lib/psto-report-action-utils'
import type { RowWithId, UsePstoReportActionsOptions } from '@/lib/psto-report-action-types'
import {
  createRequestDocumentIdentity,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

export function createPstoResultActionHandlers({
  confirmAction,
  rows,
  heatTreatmentRows,
  filteredPstoResultRows,
  managedPstoDiagramDrafts,
  nextPstoDiagramName,
  pstoResultDraft,
  pstoResultSaveBlockReason,
  selectedPstoResultRows,
  saveCheckSettings,
  pstoResultCorrectionMutation,
  pstoResultMutation,
  defaultConclusionNaming,
  setIsPstoResultManagerOpen,
  setIsPstoResultModalOpen,
  setManagedPstoDiagramDrafts,
  setMessage,
  setPstoResultDraft,
  setPstoResultRequestSearch,
}: UsePstoReportActionsOptions) {
  function openAddPstoResultModal() {
    setPstoResultRequestSearch('')
    setPstoResultDraft(createDefaultPstoResultDraft(defaultConclusionNaming))
    setIsPstoResultModalOpen(true)
  }

  function openAddPstoResultModalForRow(row: RowWithId) {
    const requestName = String(row.pstoRequest ?? '').trim()
    if (!requestName) {
      setMessage('Сначала создайте заявку ПСТО для этого стыка')
      return
    }

    const request = createRequestDocumentIdentity(requestName, row.pstoRequestDate)
    setPstoResultDraft({
      ...createDefaultPstoResultDraft(defaultConclusionNaming),
      requestName,
      requestDate: request?.date ?? '',
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

  async function deleteManagedPstoResult(row: RowWithId) {
    const confirmed = await confirmAction({
      title: 'Удалить результат ПСТО',
      itemName: String(row.joint ?? '-'),
      description: 'Дата ПСТО и диаграмма термообработки для этого стыка тоже будут очищены.',
      warning: 'Это действие нельзя отменить.',
    })
    if (!confirmed) return
    pstoResultCorrectionMutation.mutate({ record: row, action: 'deleteResult' })
  }

  function changePstoResultRequest(request: RequestDocumentIdentity | null) {
    setPstoResultDraft((current) =>
      resolvePstoResultDraftAfterRequestChange(current, heatTreatmentRows, request),
    )
  }

  function togglePstoResultRow(rowId: number) {
    const row = filteredPstoResultRows.find((candidate) => candidate.id === rowId)
    if (
      !row ||
      !canSelectPstoResultRow(
        row,
        pstoResultDraft.requestName,
        pstoResultDraft.requestDate,
      )
    ) return

    setPstoResultDraft((current) => resolvePstoResultDraftAfterRowToggle(current, heatTreatmentRows, rowId))
  }

  function toggleAllPstoResultRows() {
    setPstoResultDraft((current) =>
      resolvePstoResultDraftAfterBulkToggle(current, filteredPstoResultRows, heatTreatmentRows),
    )
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
    if (pstoResultDraft.result !== 'проведено') {
      setMessage('Выберите результат ПСТО')
      return
    }
    if (saveCheckSettings.pstoResultDateRequired && !pstoResultDraft.pstoDate) {
      setMessage('Укажите дату ПСТО')
      return
    }
    const diagramName = getRequestNameFromNaming(
      pstoResultDraft.diagramNaming,
      nextPstoDiagramName,
    )
    if (saveCheckSettings.pstoResultDiagramRequired && !diagramName) {
      setMessage('Укажите наименование диаграммы термообработки')
      return
    }

    pstoResultMutation.mutate({
      records: selectedPstoResultRows,
      pstoDate: pstoResultDraft.pstoDate,
      result: pstoResultDraft.result,
      diagramName,
      rows,
      useSystemName: pstoResultDraft.diagramNaming.mode === 'system',
    })
  }

  return {
    changePstoResultRequest,
    closeAddPstoResultModal,
    deleteManagedPstoResult,
    handleAddPstoResult,
    openAddPstoResultModal,
    openAddPstoResultModalForRow,
    openPstoResultManager,
    renameManagedPstoDiagram,
    toggleAllPstoResultRows,
    togglePstoResultRow,
  }
}
