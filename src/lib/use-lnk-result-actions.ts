import type { Dispatch, SetStateAction } from 'react'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import { filterLnkResultDraftRowResults } from '@/lib/lnk-result-draft'
import {
  canSelectLnkResultRow,
  filterLnkRowsByRequestName,
  getLnkInputMethodsForRows,
  getLnkRowRequestNames,
  rowBelongsToLnkRequest,
} from '@/lib/report-modal-rows'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

type LnkResultMutation = {
  isPending: boolean
}

type UseLnkResultActionsOptions = {
  filteredRows: WeldRow[]
  lnkRows: WeldRow[]
  draft: LnkResultDraftState
  mutation: LnkResultMutation
  setDraft: Dispatch<SetStateAction<LnkResultDraftState>>
  setIsModalOpen: (value: boolean) => void
  setIsPreviewOpen: (value: boolean) => void
  setMessage: (value: string | null) => void
  setPreservedOrderIds: Dispatch<SetStateAction<number[] | null>>
  setRequestSearch: (value: string) => void
  setShouldPinPreviewedRows: (value: boolean) => void
}

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
    setDraft((current) => {
      const rowIds = new Set(current.rowIds)
      const selectedRows = lnkRows.filter((row) => rowIds.has(row.id))
      const requestRows = requestName ? filterLnkRowsByRequestName(lnkRows, requestName) : []
      const methodRows = selectedRows.length > 0 ? [...selectedRows, ...requestRows] : requestName ? requestRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, '')
      const methodKey = current.methodKey && methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }

  function changeLnkResultMethod(methodKey: WeldFieldKey | '') {
    setDraft((current) => {
      if (!methodKey) return { ...current, methodKey: '' }
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = lnkRows.find((candidate) => candidate.id === id)
          return row ? canSelectLnkResultRow(row, '', methodKey) : false
        }),
      )
      return { ...current, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
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
      const selectedRows = lnkRows.filter((candidate) => rowIds.has(candidate.id))
      const requestName = current.requestName && selectedRows.some((candidate) => rowBelongsToLnkRequest(candidate, current.requestName))
        ? current.requestName
        : ''
      const methodRows = requestName ? filterLnkRowsByRequestName(lnkRows, requestName) : selectedRows.length > 0 ? selectedRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, requestName)
      const methodKey = current.methodKey && methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
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
      const selectedRows = lnkRows.filter((row) => rowIds.has(row.id))
      const requestName = current.requestName && selectedRows.some((row) => rowBelongsToLnkRequest(row, current.requestName))
        ? current.requestName
        : ''
      const methodRows = requestName ? filterLnkRowsByRequestName(lnkRows, requestName) : selectedRows.length > 0 ? selectedRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, requestName)
      const methodKey = current.methodKey && methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
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
