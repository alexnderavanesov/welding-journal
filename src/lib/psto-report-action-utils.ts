import { canSelectPstoResultRow, rowBelongsToPstoRequest } from '@/lib/report-modal-rows'
import { hasText } from '@/lib/report-value-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import {
  findRequestDocumentIdentity,
  getPstoRequestDocumentIdentities,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

type RowWithId = WeldRow

export function getPstoResultRequestIdentity(
  currentRequest: Pick<RequestDocumentIdentity, 'name' | 'date'>,
  selectedRows: RowWithId[],
) {
  const requestOptions = getPstoRequestDocumentIdentities(selectedRows)
  const current = findRequestDocumentIdentity(
    requestOptions,
    currentRequest.name,
    currentRequest.date,
  )
  if (current && current.name === currentRequest.name && current.date === currentRequest.date) {
    return current
  }
  return requestOptions.length === 1 ? requestOptions[0] : null
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
  request: RequestDocumentIdentity | null,
) {
  if (!request) return { ...current, requestName: '', requestDate: '' }
  const rowIds = new Set(
    [...current.rowIds].filter((id) => {
      const row = heatTreatmentRows.find((candidate) => candidate.id === id)
      return row ? rowBelongsToPstoRequest(row, request.name, request.date) : false
    }),
  )
  return {
    ...current,
    requestName: request.name,
    requestDate: request.date,
    rowIds,
  }
}

export function resolvePstoResultDraftAfterRowIdsChange(
  current: PstoResultDraftState,
  heatTreatmentRows: RowWithId[],
  rowIds: Set<number>,
) {
  const selectedRows = heatTreatmentRows.filter((row) => rowIds.has(row.id))
  const request = getPstoResultRequestIdentity(
    { name: current.requestName, date: current.requestDate },
    selectedRows,
  )
  return {
    ...current,
    requestName: request?.name ?? '',
    requestDate: request?.date ?? '',
    rowIds,
  }
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
    filteredRows
      .filter((row) =>
        canSelectPstoResultRow(row, current.requestName, current.requestDate),
      )
      .map((row) => row.id),
  )
  if (filteredIds.size === 0) return current
  const allSelected = [...filteredIds].every((id) => current.rowIds.has(id))
  const rowIds = allSelected
    ? new Set([...current.rowIds].filter((id) => !filteredIds.has(id)))
    : new Set([...current.rowIds, ...filteredIds])
  return resolvePstoResultDraftAfterRowIdsChange(current, heatTreatmentRows, rowIds)
}
