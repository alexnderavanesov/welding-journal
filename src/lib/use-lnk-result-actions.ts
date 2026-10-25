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
  getLnkRowRequestDocumentIdentities,
} from '@/lib/report-modal-rows'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { getLnkRequestDocumentIdentities, type RequestDocumentIdentity } from '@/lib/request-document-identity'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'

export function useLnkResultActions({
  controlProcessSettings,
  filteredRows,
  lnkRows,
  draft,
  mutation,
  defaultConclusionNaming,
  setDraft,
  setIsModalOpen,
  setMessage,
  setPreservedOrderIds,
}: UseLnkResultActionsOptions) {
  function openAddLnkResultModal() {
    setPreservedOrderIds(null)
    setDraft(createDefaultLnkResultDraft(defaultConclusionNaming))
    setIsModalOpen(true)
  }

  const getCommonLnkRequests = (selectedRows: WeldRow[]) => {
    if (selectedRows.length === 0) return []
    const [firstRow, ...restRows] = selectedRows
    const firstRequests = getLnkRequestDocumentIdentities([firstRow])
    const common = new Set(firstRequests.map((request) => request.key))
    for (const selectedRow of restRows) {
      const keys = new Set(getLnkRequestDocumentIdentities([selectedRow]).map((request) => request.key))
      for (const key of [...common]) {
        if (!keys.has(key)) common.delete(key)
      }
    }
    return firstRequests.filter((request) => common.has(request.key))
  }

  function openAddLnkResultModalForRows(selectedRows: WeldRow[]) {
    if (selectedRows.length === 0) {
      openAddLnkResultModal()
      return
    }
    if (selectedRows.length === 1) {
      openAddLnkResultModalForRow(selectedRows[0])
      return
    }
    if (selectedRows.some((selectedRow) => getLnkRowRequestNames(selectedRow).length === 0)) {
      setMessage('Для части выбранных стыков нет заявки ЛНК')
      return
    }

    const commonRequests = getCommonLnkRequests(selectedRows)
    const request = commonRequests.length === 1 ? commonRequests[0] : null
    setPreservedOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setDraft({
      ...createDefaultLnkResultDraft(defaultConclusionNaming),
      requestName: request?.name ?? '',
      requestDate: request?.date ?? '',
      rowIds: new Set(selectedRows.map((selectedRow) => selectedRow.id)),
      search: '',
    })
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
    setDraft({
      ...createDefaultLnkResultDraft(defaultConclusionNaming),
      requestName: request?.name ?? '',
      requestDate: request?.date ?? '',
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
    })
    setIsModalOpen(true)
  }

  function openAddLnkResultModalForMethod(row: WeldRow, methodKey: WeldFieldKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    const requestName = method ? String(row[method.requestKey] ?? '').trim() : ''
    const requestDate = method ? String(row[method.requestDateKey] ?? '').trim() : ''
    if (!method || !requestName) {
      setMessage('Сначала создайте заявку ЛНК для этого вида контроля')
      return
    }

    setPreservedOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setDraft({
      ...createDefaultLnkResultDraft(defaultConclusionNaming),
      requestName,
      requestDate,
      methodKey: method.requestKey,
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
    })
    setIsModalOpen(true)
  }

  function closeAddLnkResultModal() {
    if (mutation.isPending) return
    setIsModalOpen(false)
  }

  function changeLnkResultRequest(request: RequestDocumentIdentity | null) {
    setDraft((current) => resolveLnkResultDraftAfterRequestChange(current, lnkRows, request))
  }

  function changeLnkResultMethod(methodKey: WeldFieldKey | '') {
    setDraft((current) => resolveLnkResultDraftAfterMethodChange(
      current,
      lnkRows,
      methodKey,
      controlProcessSettings,
    ))
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
        controlProcessSettings,
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

  function setLnkResultRows(rowIds: number[]) {
    setDraft((current) => {
      const selectableRowIds = new Set(rowIds.filter((rowId) => {
        const row = lnkRows.find((candidate) => candidate.id === rowId)
        return Boolean(row && canSelectLnkResultRow(
          row,
          current.requestName,
          current.methodKey,
          current.requestDate,
          controlProcessSettings,
        ))
      }))
      return resolveLnkResultDraftAfterRowIdsChange(current, lnkRows, selectableRowIds)
    })
  }

  return {
    changeLnkResultMethod,
    changeLnkResultRequest,
    closeAddLnkResultModal,
    openAddLnkResultModal,
    openAddLnkResultModalForMethod,
    openAddLnkResultModalForRow,
    openAddLnkResultModalForRows,
    setLnkResultRows,
    toggleAllLnkResultRows,
    toggleLnkResultRow,
  }
}
