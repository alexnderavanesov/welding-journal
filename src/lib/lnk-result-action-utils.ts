import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { filterLnkResultDraftRowResults } from '@/lib/lnk-result-draft'
import {
  canSelectLnkResultRow,
  filterLnkRowsByRequestName,
  getLnkInputMethodsForRows,
  rowBelongsToLnkRequest,
} from '@/lib/report-modal-rows'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'

function keepAvailableMethodKey(
  methodKey: WeldFieldKey | '',
  methodRows: WeldRow[],
  requestName: string,
): LnkResultDraftState['methodKey'] {
  if (!methodKey) return ''
  const methods = getLnkInputMethodsForRows(methodRows, requestName)
  return methods.some((method) => method.requestKey === methodKey) ? methodKey : ''
}

export function resolveLnkResultDraftAfterRequestChange(
  current: LnkResultDraftState,
  lnkRows: WeldRow[],
  request: RequestDocumentIdentity | null,
): LnkResultDraftState {
  const requestName = request?.name ?? ''
  const requestDate = request?.date ?? ''
  const rowIds = new Set(
    [...current.rowIds].filter((id) => {
      if (!request) return true
      const row = lnkRows.find((candidate) => candidate.id === id)
      return row ? rowBelongsToLnkRequest(row, requestName, requestDate) : false
    }),
  )
  const selectedRows = lnkRows.filter((row) => rowIds.has(row.id))
  const requestRows = request
    ? filterLnkRowsByRequestName(lnkRows, requestName, requestDate)
    : []
  const methodRows = selectedRows.length > 0
    ? [...selectedRows, ...requestRows]
    : requestName
      ? requestRows
      : lnkRows
  const methodKey = keepAvailableMethodKey(current.methodKey, methodRows, '')
  return {
    ...current,
    requestName,
    requestDate,
    methodKey,
    rowIds,
    rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds),
  }
}

export function resolveLnkResultDraftAfterMethodChange(
  current: LnkResultDraftState,
  lnkRows: WeldRow[],
  methodKey: WeldFieldKey | '',
): LnkResultDraftState {
  if (!methodKey) return { ...current, methodKey: '' }
  const rowIds = new Set(
    [...current.rowIds].filter((id) => {
      const row = lnkRows.find((candidate) => candidate.id === id)
      return row
        ? canSelectLnkResultRow(
            row,
            current.requestName,
            methodKey,
            current.requestDate,
          )
        : false
    }),
  )
  return {
    ...current,
    methodKey,
    rowIds,
    rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds),
  }
}

export function resolveLnkResultDraftAfterRowIdsChange(
  current: LnkResultDraftState,
  lnkRows: WeldRow[],
  rowIds: Set<number>,
): LnkResultDraftState {
  const selectedRows = lnkRows.filter((candidate) => rowIds.has(candidate.id))
  const requestName = current.requestName
    && selectedRows.some((candidate) =>
      rowBelongsToLnkRequest(candidate, current.requestName, current.requestDate),
    )
    ? current.requestName
    : ''
  const requestDate = requestName ? current.requestDate : ''
  const methodRows = requestName
    ? filterLnkRowsByRequestName(lnkRows, requestName, requestDate)
    : selectedRows.length > 0
      ? selectedRows
      : lnkRows
  const methodKey = keepAvailableMethodKey(current.methodKey, methodRows, requestName)
  return {
    ...current,
    requestName,
    requestDate,
    methodKey,
    rowIds,
    rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds),
  }
}
