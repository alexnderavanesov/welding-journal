import type { PstoWorkflowRowsRequest } from '@/server/weld-contracts'

type PstoWorkflowModalState = {
  shouldLoadFullWeldRows: boolean
  isPstoRequestModalOpen: boolean
  isPstoRequestManagerOpen: boolean
  isPstoResultModalOpen: boolean
  isPstoResultManagerOpen: boolean
  tvmtWorkflowMode: 'request' | 'result' | null
  pstoRepeatWorkflowMode: 'request' | 'result' | null
  fieldEditingRowId: number | null
  resultManagerRowIds: readonly number[]
  resultRegistryAll: boolean
  resultRegistrySearch: string
  resultRegistryLimit: number
  managedRequestName: string
  managedRequestDate: string
  requestCandidateRowIds: readonly number[]
  requestCandidateSearch: string
  resultCandidateRowIds: readonly number[]
  resultCandidateSearch: string
  resultCandidateRequestName: string
  resultCandidateRequestDate: string
  otherCandidateRowIds: readonly number[]
  repeatCandidateSearch: string
  tvmtCandidateSearch: string
  repeatCandidateRequestName: string
  repeatCandidateRequestDate: string
  tvmtCandidateRequestName: string
  tvmtCandidateRequestDate: string
}

export function getPstoWorkflowRowsRequest(
  state: PstoWorkflowModalState,
): PstoWorkflowRowsRequest | null {
  if (state.shouldLoadFullWeldRows) return null
  if (state.isPstoRequestModalOpen) {
    return candidateRequest(
      'requestCandidates',
      state.requestCandidateRowIds,
      state.requestCandidateSearch,
    )
  }
  if (state.isPstoRequestManagerOpen) {
    return state.managedRequestName.trim()
      ? {
          scope: 'requestRegistry',
          rowIds: null,
          requestName: state.managedRequestName,
          requestDate: state.managedRequestDate,
        }
      : null
  }
  if (state.isPstoResultModalOpen) {
    return candidateRequest(
      'resultCandidates',
      state.resultCandidateRowIds,
      state.resultCandidateSearch,
      state.resultCandidateRequestName,
      state.resultCandidateRequestDate,
    )
  }
  if (state.isPstoResultManagerOpen) {
    return state.resultRegistryAll
      ? {
          scope: 'resultRegistry',
          rowIds: null,
          ...(state.resultRegistrySearch.trim() ? { search: state.resultRegistrySearch.trim() } : {}),
          limit: state.resultRegistryLimit,
        }
      : { scope: 'resultRegistry', rowIds: [...state.resultManagerRowIds] }
  }
  if (state.pstoRepeatWorkflowMode) {
    return candidateRequest(
      state.pstoRepeatWorkflowMode === 'request'
        ? 'requestCandidates'
        : 'resultCandidates',
      state.otherCandidateRowIds,
      state.repeatCandidateSearch,
      state.repeatCandidateRequestName,
      state.repeatCandidateRequestDate,
    )
  }
  if (state.tvmtWorkflowMode) {
    return candidateRequest(
      state.tvmtWorkflowMode === 'request'
        ? 'tvmtRequestCandidates'
        : 'tvmtResultCandidates',
      state.otherCandidateRowIds,
      state.tvmtCandidateSearch,
      state.tvmtCandidateRequestName,
      state.tvmtCandidateRequestDate,
    )
  }
  if (state.fieldEditingRowId) {
    return { scope: 'fieldRows', rowIds: [state.fieldEditingRowId] }
  }
  return null
}

function candidateRequest(
  scope: Extract<PstoWorkflowRowsRequest['scope'], `${string}Candidates`>,
  includeRowIds: readonly number[],
  search = '',
  requestName = '',
  requestDate = '',
): PstoWorkflowRowsRequest {
  return {
    scope,
    rowIds: null,
    ...(includeRowIds.length > 0 ? { includeRowIds: [...includeRowIds] } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(requestName.trim()
      ? { requestName: requestName.trim(), requestDate: requestDate.trim() }
      : {}),
  }
}

export function shouldLoadPstoWorkflowSummary({
  isPstoReportActive,
  shouldLoadFullWeldRows,
  isPstoWorkflowMenuOpen,
}: {
  isPstoReportActive: boolean
  shouldLoadFullWeldRows: boolean
  isPstoWorkflowMenuOpen: boolean
}) {
  return isPstoReportActive && !shouldLoadFullWeldRows && isPstoWorkflowMenuOpen
}
