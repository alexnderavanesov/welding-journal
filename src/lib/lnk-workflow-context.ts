import type {
  LnkWorkflowRowsRequest,
  LnkWorkflowRowScope,
} from '@/server/weld-contracts'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkWorkflowModalState = {
  shouldLoadFullWeldRows: boolean
  isLnkRequestModalOpen: boolean
  isLnkRequestManagerOpen: boolean
  isLnkResultModalOpen: boolean
  isLnkResultManagerOpen: boolean
  isLnkOfficialityModalOpen: boolean
  preHeatTreatmentLnkWorkflowMode: 'request' | 'result' | null
  isPreHeatTreatmentResultManagerOpen: boolean
  preHeatTreatmentResultManagerMode: 'request' | 'result'
  managedLnkResultOrderIds: readonly number[] | null
  preHeatTreatmentResultManagerRowIds: readonly number[] | null
  fieldEditingRowId: number | null
  managedLnkRequestName: string
  managedLnkRequestDate: string
  requestCandidateRowIds: readonly number[]
  requestCandidateSearch: string
  requestCandidateMethodKeys: readonly WeldFieldKey[]
  resultCandidateRowIds: readonly number[]
  resultCandidateSearch: string
  resultCandidateMethodKey: WeldFieldKey | ''
  resultCandidateRequestName: string
  resultCandidateRequestDate: string
  allowPrimaryBeforePreviousStagesComplete: boolean
  officialityCandidateRowIds: readonly number[]
  officialityCandidateSearch: string
  otherCandidateRowIds: readonly number[]
  otherCandidateSearch: string
  otherCandidateMethodKeys: readonly WeldFieldKey[]
  otherCandidateRequestName: string
  otherCandidateRequestDate: string
  resultRegistrySearch: string
  resultRegistryFilter: 'all' | 'годен' | 'ремонт' | 'вырез'
  resultRegistryLimit: number
}

export function shouldLoadLnkWorkflowSummary({
  isLnkReportActive,
  shouldLoadFullWeldRows,
  isLnkWorkflowMenuOpen,
}: {
  isLnkReportActive: boolean
  shouldLoadFullWeldRows: boolean
  isLnkWorkflowMenuOpen: boolean
}) {
  return isLnkReportActive && !shouldLoadFullWeldRows && isLnkWorkflowMenuOpen
}

export function shouldLoadLnkWorkflowRequestSummary({
  isLnkReportActive,
  shouldLoadFullWeldRows,
  isLnkRequestModalOpen,
  isLnkRequestManagerOpen,
  isLnkFieldEditing,
}: {
  isLnkReportActive: boolean
  shouldLoadFullWeldRows: boolean
  isLnkRequestModalOpen: boolean
  isLnkRequestManagerOpen: boolean
  isLnkFieldEditing: boolean
}) {
  return isLnkReportActive && !shouldLoadFullWeldRows && (
    isLnkRequestModalOpen || isLnkRequestManagerOpen || isLnkFieldEditing
  )
}

export function getLnkWorkflowRowsRequest(
  state: LnkWorkflowModalState,
): LnkWorkflowRowsRequest | null {
  if (state.shouldLoadFullWeldRows) return null
  if (state.isLnkRequestModalOpen) {
    return candidateRequest(
      'requestCandidates',
      state.requestCandidateRowIds,
      state.requestCandidateSearch,
      {
        methodKeys: state.requestCandidateMethodKeys,
        allowPrimaryBeforePreviousStagesComplete: state.allowPrimaryBeforePreviousStagesComplete,
      },
    )
  }
  if (state.isLnkRequestManagerOpen) {
    const requestName = state.managedLnkRequestName.trim()
    return requestName
      ? {
          scope: 'requestRegistry',
          rowIds: null,
          requestName,
          requestDate: state.managedLnkRequestDate.trim(),
        }
      : null
  }
  if (state.isLnkResultModalOpen) {
    return candidateRequest(
      'resultCandidates',
      state.resultCandidateRowIds,
      state.resultCandidateSearch,
      {
        methodKeys: state.resultCandidateMethodKey ? [state.resultCandidateMethodKey] : [],
        requestName: state.resultCandidateRequestName,
        requestDate: state.resultCandidateRequestDate,
        allowPrimaryBeforePreviousStagesComplete: state.allowPrimaryBeforePreviousStagesComplete,
      },
    )
  }
  if (state.isLnkResultManagerOpen) {
    const rowIds = toIds(state.managedLnkResultOrderIds)
    return {
      scope: 'resultRegistry',
      rowIds,
      ...(rowIds === null && state.resultRegistrySearch.trim()
        ? { search: state.resultRegistrySearch.trim() }
        : {}),
      ...(rowIds === null && state.resultRegistryFilter !== 'all'
        ? { resultFilter: state.resultRegistryFilter }
        : {}),
      ...(rowIds === null ? { limit: state.resultRegistryLimit } : {}),
    }
  }
  if (state.isLnkOfficialityModalOpen) {
    return candidateRequest(
      'officialityCandidates',
      state.officialityCandidateRowIds,
      state.officialityCandidateSearch,
    )
  }
  if (state.preHeatTreatmentLnkWorkflowMode) {
    return candidateRequest(
      state.preHeatTreatmentLnkWorkflowMode === 'request'
        ? 'preHeatTreatmentRequestCandidates'
        : 'preHeatTreatmentResultCandidates',
      state.otherCandidateRowIds,
      state.otherCandidateSearch,
      {
        methodKeys: state.otherCandidateMethodKeys,
        requestName: state.otherCandidateRequestName,
        requestDate: state.otherCandidateRequestDate,
      },
    )
  }
  if (state.isPreHeatTreatmentResultManagerOpen) {
    return {
      scope: state.preHeatTreatmentResultManagerMode === 'request'
        ? 'preHeatTreatmentRequestRegistry'
        : 'preHeatTreatmentResultRegistry',
      rowIds: toIds(state.preHeatTreatmentResultManagerRowIds),
    }
  }
  if (state.fieldEditingRowId) {
    return { scope: 'fieldRows', rowIds: [state.fieldEditingRowId] }
  }
  return null
}

function candidateRequest(
  scope: LnkWorkflowRowScope,
  includeRowIds: readonly number[] = [],
  search = '',
  filters: {
    methodKeys?: readonly WeldFieldKey[]
    requestName?: string
    requestDate?: string
    allowPrimaryBeforePreviousStagesComplete?: boolean
  } = {},
): LnkWorkflowRowsRequest {
  return {
    scope,
    rowIds: null,
    ...(includeRowIds.length > 0 ? { includeRowIds: [...includeRowIds] } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(filters.methodKeys?.length ? { methodKeys: [...filters.methodKeys] } : {}),
    ...(filters.requestName?.trim()
      ? { requestName: filters.requestName.trim(), requestDate: filters.requestDate?.trim() ?? '' }
      : {}),
    ...(filters.allowPrimaryBeforePreviousStagesComplete
      ? { allowPrimaryBeforePreviousStagesComplete: true }
      : {}),
  }
}

function toIds(rowIds: readonly number[] | null) {
  return rowIds ? [...rowIds] : null
}
