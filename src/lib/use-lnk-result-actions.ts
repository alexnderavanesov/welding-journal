import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import {
  resolveLnkResultDraftAfterMethodChange,
  resolveLnkResultDraftAfterRequestChange,
  resolveLnkResultDraftAfterRowIdsChange,
} from '@/lib/lnk-result-action-utils'
import type { UseLnkResultActionsOptions } from '@/lib/lnk-report-action-types'
import {
  canSelectLnkResultRow,
  getLnkRowRequestNames,
} from '@/lib/report-modal-rows'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export function useLnkResultActions({
  filteredRows,
  lnkRows,
  draft,
  mutation,
  setDraft,
  setIsModalOpen,
  setIsPreviewOpen,
  setMessage,
  setPreservedOrderIds,
  setRequestSearch,
  setShouldPinPreviewedRows,
}: UseLnkResultActionsOptions) {
  function openAddLnkResultModal() {
    setPreservedOrderIds(null)
    setRequestSearch('')
    setDraft(createDefaultLnkResultDraft())
    setShouldPinPreviewedRows(false)
    setIsModalOpen(true)
  }

  function openAddLnkResultModalForRow(row: WeldInput & { id: number }) {
    const requestNames = getLnkRowRequestNames(row)
    if (requestNames.length === 0) {
      setMessage('Сначала создайте заявку ЛНК для этого стыка')
      return
    }

    const requestName = requestNames.length === 1 ? requestNames[0] : ''
    setPreservedOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setRequestSearch(requestName)
    setDraft({
      ...createDefaultLnkResultDraft(),
      requestName,
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
    })
    setShouldPinPreviewedRows(false)
    setIsModalOpen(true)
  }

  function closeAddLnkResultModal() {
    if (mutation.isPending) return
    setRequestSearch('')
    setIsPreviewOpen(false)
    setShouldPinPreviewedRows(false)
    setIsModalOpen(false)
  }

  function changeLnkResultRequest(requestName: string) {
    setDraft((current) => resolveLnkResultDraftAfterRequestChange(current, lnkRows, requestName))
  }

  function changeLnkResultMethod(methodKey: WeldFieldKey | '') {
    setDraft((current) => resolveLnkResultDraftAfterMethodChange(current, lnkRows, methodKey))
  }

  function toggleLnkResultRow(rowId: number) {
    const row = filteredRows.find((candidate) => candidate.id === rowId)
    if (!row || !canSelectLnkResultRow(row, draft.requestName, draft.methodKey)) return

    setDraft((current) => {
      const rowIds = new Set(current.rowIds)
      if (rowIds.has(rowId)) {
        rowIds.delete(rowId)
      } else {
        rowIds.add(rowId)
      }
      return resolveLnkResultDraftAfterRowIdsChange(current, lnkRows, rowIds)
    })
  }

  function toggleAllLnkResultRows() {
    setDraft((current) => {
      const filteredIds = new Set(
        filteredRows
          .filter((row) => canSelectLnkResultRow(row, current.requestName, current.methodKey))
          .map((row) => row.id),
      )
      if (filteredIds.size === 0) return current
      const allSelected = [...filteredIds].every((id) => current.rowIds.has(id))
      const rowIds = allSelected
        ? new Set([...current.rowIds].filter((id) => !filteredIds.has(id)))
        : new Set([...current.rowIds, ...filteredIds])
      return resolveLnkResultDraftAfterRowIdsChange(current, lnkRows, rowIds)
    })
  }

  return {
    changeLnkResultMethod,
    changeLnkResultRequest,
    closeAddLnkResultModal,
    openAddLnkResultModal,
    openAddLnkResultModalForRow,
    toggleAllLnkResultRows,
    toggleLnkResultRow,
  }
}
