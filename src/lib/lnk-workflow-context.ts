import type {
  LnkWorkflowRowsRequest,
  LnkWorkflowRowScope,
} from '@/server/weld-contracts'

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
}

export function shouldLoadFullLnkReportContext({
  shouldLoadFullWeldRows,
  isLnkShowMenuOpen,
  isLnkFieldEditing,
}: {
  shouldLoadFullWeldRows: boolean
  isLnkShowMenuOpen: boolean
  isLnkFieldEditing: boolean
}) {
  return !shouldLoadFullWeldRows && (isLnkShowMenuOpen || isLnkFieldEditing)
}

export function shouldLoadLnkWorkflowSummary({
  isLnkReportActive,
  shouldLoadFullWeldRows,
  isLnkWorkflowMenuOpen,
  isLnkRequestModalOpen,
  isLnkRequestManagerOpen,
}: {
  isLnkReportActive: boolean
  shouldLoadFullWeldRows: boolean
  isLnkWorkflowMenuOpen: boolean
  isLnkRequestModalOpen: boolean
  isLnkRequestManagerOpen: boolean
}) {
  return isLnkReportActive && !shouldLoadFullWeldRows && (
    isLnkWorkflowMenuOpen || isLnkRequestModalOpen || isLnkRequestManagerOpen
  )
}

export function getLnkWorkflowRowsRequest(
  state: LnkWorkflowModalState,
): LnkWorkflowRowsRequest | null {
  if (state.shouldLoadFullWeldRows) return null
  if (state.isLnkRequestModalOpen) {
    return candidateRequest('requestCandidates')
  }
  if (state.isLnkRequestManagerOpen) return { scope: 'requestRegistry', rowIds: null }
  if (state.isLnkResultModalOpen) {
    return candidateRequest('resultCandidates')
  }
  if (state.isLnkResultManagerOpen) {
    return { scope: 'resultRegistry', rowIds: toIds(state.managedLnkResultOrderIds) }
  }
  if (state.isLnkOfficialityModalOpen) {
    return candidateRequest('officialityCandidates')
  }
  if (state.preHeatTreatmentLnkWorkflowMode) {
    return candidateRequest(
      state.preHeatTreatmentLnkWorkflowMode === 'request'
        ? 'preHeatTreatmentRequestCandidates'
        : 'preHeatTreatmentResultCandidates',
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
  return null
}

function candidateRequest(
  scope: LnkWorkflowRowScope,
): LnkWorkflowRowsRequest {
  return { scope, rowIds: null }
}

function toIds(rowIds: readonly number[] | null) {
  return rowIds ? [...rowIds] : null
}
