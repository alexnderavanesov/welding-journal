import { collectRequestNames, sortPstoRequestNamesNewestFirst } from '@/lib/report-naming'
import { canSelectPstoResultRow, rowBelongsToPstoRequest } from '@/lib/report-modal-rows'
import { hasText } from '@/lib/report-value-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoResultDraftState } from '@/lib/report-draft-state'

type RowWithId = WeldRow

export function getPstoResultRequestName(currentRequestName: string, selectedRows: RowWithId[]) {
  const requestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(selectedRows, ['pstoRequest']))
  if (currentRequestName && requestOptions.includes(currentRequestName)) return currentRequestName
  return requestOptions.length === 1 ? requestOptions[0] : ''
}

export function buildManagedPstoDiagramDrafts(rows: RowWithId[]) {
  return Object.fromEntries(
    rows
      .filter((row) => hasText(row.pstoResult) || hasText(row.heatTreatmentDiagram) || hasText(row.pstoDate))
      .map((row) => [row.id, String(row.heatTreatmentDiagram ?? '').trim()]),
  )
}

export function resolvePstoResultDraftAfterRequestChange(
  current: PstoResultDraftState,
  heatTreatmentRows: RowWithId[],
  requestName: string,
) {
  if (!requestName) return { ...current, requestName: '' }
  const rowIds = new Set(
    [...current.rowIds].filter((id) => {
      const row = heatTreatmentRows.find((candidate) => candidate.id === id)
      return row ? rowBelongsToPstoRequest(row, requestName) : false
    }),
  )
  return { ...current, requestName, rowIds }
}

export function resolvePstoResultDraftAfterRowIdsChange(
  current: PstoResultDraftState,
  heatTreatmentRows: RowWithId[],
  rowIds: Set<number>,
) {
  const selectedRows = heatTreatmentRows.filter((row) => rowIds.has(row.id))
  const requestName = getPstoResultRequestName(current.requestName, selectedRows)
  return { ...current, requestName, rowIds }
}

export function resolvePstoResultDraftAfterRowToggle(
  current: PstoResultDraftState,
  heatTreatmentRows: RowWithId[],
  rowId: number,
) {
  const rowIds = new Set(current.rowIds)
  if (rowIds.has(rowId)) {
    rowIds.delete(rowId)
  } else {
    rowIds.add(rowId)
  }
  return resolvePstoResultDraftAfterRowIdsChange(current, heatTreatmentRows, rowIds)
}

export function resolvePstoResultDraftAfterBulkToggle(
  current: PstoResultDraftState,
  filteredRows: RowWithId[],
  heatTreatmentRows: RowWithId[],
) {
  const filteredIds = new Set(
    filteredRows.filter((row) => canSelectPstoResultRow(row, current.requestName)).map((row) => row.id),
  )
  if (filteredIds.size === 0) return current
  const allSelected = [...filteredIds].every((id) => current.rowIds.has(id))
  const rowIds = allSelected
    ? new Set([...current.rowIds].filter((id) => !filteredIds.has(id)))
    : new Set([...current.rowIds, ...filteredIds])
  return resolvePstoResultDraftAfterRowIdsChange(current, heatTreatmentRows, rowIds)
}
