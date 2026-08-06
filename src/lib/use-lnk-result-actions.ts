import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import {
  resolveLnkResultDraftAfterMethodChange,
  resolveLnkResultDraftAfterRequestChange,
  resolveLnkResultDraftAfterRowIdsChange,
} from '@/lib/lnk-result-action-utils'
import type { UseLnkResultActionsOptions } from '@/lib/lnk-report-action-types'
import {
  canSelectLnkResultRow,
  getLnkRowRequestDocumentIdentities,
} from '@/lib/report-modal-rows'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'

export function useLnkResultActions({
  filteredRows,
  lnkRows,
  draft,
  mutation,
  defaultConclusionNaming,
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
    setDraft(createDefaultLnkResultDraft(defaultConclusionNaming))
    setShouldPinPreviewedRows(false)
    setIsModalOpen(true)
  }

  function openAddLnkResultModalForRow(row: WeldRow) {
    const requests = getLnkRowRequestDocumentIdentities(row)
    if (requests.length === 0) {
      setMessage('Сначала создайте заявку ЛНК для этого стыка')
      return
    }

    const request = requests.length === 1 ? requests[0] : null
    setPreservedOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setRequestSearch(request?.name ?? '')
    setDraft({
      ...createDefaultLnkResultDraft(defaultConclusionNaming),
      requestName: request?.name ?? '',
      requestDate: request?.date ?? '',
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

  function changeLnkResultRequest(request: RequestDocumentIdentity | null) {
    setDraft((current) => resolveLnkResultDraftAfterRequestChange(current, lnkRows, request))
  }

  function changeLnkResultMethod(methodKey: WeldFieldKey | '') {
    setDraft((current) => resolveLnkResultDraftAfterMethodChange(current, lnkRows, methodKey))
  }

  function toggleLnkResultRow(rowId: number) {
    const row = filteredRows.find((candidate) => candidate.id === rowId)
    if (
      !row ||
      !canSelectLnkResultRow(
        row,
        draft.requestName,
        draft.methodKey,
        draft.requestDate,
      )
    ) return

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
          .filter((row) =>
            canSelectLnkResultRow(
              row,
              current.requestName,
              current.methodKey,
              current.requestDate,
            ),
          )
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
