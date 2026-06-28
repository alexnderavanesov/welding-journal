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

function keepAvailableMethodKey(
  methodKey: WeldFieldKey | '',
  methodRows: WeldRow[],
  requestName: string,
) {
  if (!methodKey) return ''
  const methods = getLnkInputMethodsForRows(methodRows, requestName)
  return methods.some((method) => method.requestKey === methodKey) ? methodKey : ''
}

export function resolveLnkResultDraftAfterRequestChange(
  current: LnkResultDraftState,
  lnkRows: WeldRow[],
  requestName: string,
) {
  const rowIds = new Set(current.rowIds)
  const selectedRows = lnkRows.filter((row) => rowIds.has(row.id))
  const requestRows = requestName ? filterLnkRowsByRequestName(lnkRows, requestName) : []
  const methodRows = selectedRows.length > 0
    ? [...selectedRows, ...requestRows]
    : requestName
      ? requestRows
      : lnkRows
  const methodKey = keepAvailableMethodKey(current.methodKey, methodRows, '')
  return {
    ...current,
    requestName,
    methodKey,
    rowIds,
    rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds),
  }
}

export function resolveLnkResultDraftAfterMethodChange(
  current: LnkResultDraftState,
  lnkRows: WeldRow[],
  methodKey: WeldFieldKey | '',
) {
  if (!methodKey) return { ...current, methodKey: '' }
  const rowIds = new Set(
    [...current.rowIds].filter((id) => {
      const row = lnkRows.find((candidate) => candidate.id === id)
      return row ? canSelectLnkResultRow(row, '', methodKey) : false
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
) {
  const selectedRows = lnkRows.filter((candidate) => rowIds.has(candidate.id))
  const requestName = current.requestName
    && selectedRows.some((candidate) => rowBelongsToLnkRequest(candidate, current.requestName))
    ? current.requestName
    : ''
  const methodRows = requestName
    ? filterLnkRowsByRequestName(lnkRows, requestName)
    : selectedRows.length > 0
      ? selectedRows
      : lnkRows
  const methodKey = keepAvailableMethodKey(current.methodKey, methodRows, requestName)
  return {
    ...current,
    requestName,
    methodKey,
    rowIds,
    rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds),
  }
}
