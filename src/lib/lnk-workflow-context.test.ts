import { describe, expect, it } from 'vitest'

import {
  getLnkWorkflowRowsRequest,
  shouldLoadFullLnkReportContext,
  shouldLoadLnkWorkflowSummary,
} from '@/lib/lnk-workflow-context'

describe('LNK workflow context routing', () => {
  it('reserves the full LNK context for report output and field editing', () => {
    expect(shouldLoadFullLnkReportContext({
      shouldLoadFullWeldRows: false,
      isLnkShowMenuOpen: false,
      isLnkFieldEditing: false,
    })).toBe(false)
    expect(shouldLoadFullLnkReportContext({
      shouldLoadFullWeldRows: false,
      isLnkShowMenuOpen: true,
      isLnkFieldEditing: false,
    })).toBe(true)
    expect(shouldLoadFullLnkReportContext({
      shouldLoadFullWeldRows: false,
      isLnkShowMenuOpen: false,
      isLnkFieldEditing: true,
    })).toBe(true)
    expect(shouldLoadFullLnkReportContext({
      shouldLoadFullWeldRows: true,
      isLnkShowMenuOpen: true,
      isLnkFieldEditing: true,
    })).toBe(false)
  })

  it.each([
    ['isLnkRequestModalOpen', 'requestCandidates'],
    ['isLnkRequestManagerOpen', 'requestRegistry'],
    ['isLnkResultModalOpen', 'resultCandidates'],
    ['isLnkResultManagerOpen', 'resultRegistry'],
    ['isLnkOfficialityModalOpen', 'officialityCandidates'],
  ] as const)('maps %s to %s without a whole-report request', (stateKey, scope) => {
    const state = createState()
    state[stateKey] = true

    expect(getLnkWorkflowRowsRequest(state)).toEqual({ scope, rowIds: null })
  })

  it('keeps candidate query identities independent from checkbox selection', () => {
    const state = createState()
    state.isLnkRequestModalOpen = true

    const first = getLnkWorkflowRowsRequest(state)
    const second = getLnkWorkflowRowsRequest(state)

    expect(first).toEqual({ scope: 'requestCandidates', rowIds: null })
    expect(second).toEqual(first)
  })

  it('scopes result registries to explicitly selected rows', () => {
    const state = createState()
    state.isLnkResultManagerOpen = true
    state.managedLnkResultOrderIds = [9, 4]

    expect(getLnkWorkflowRowsRequest(state)).toEqual({
      scope: 'resultRegistry',
      rowIds: [9, 4],
    })
  })

  it('routes before-heat-treatment workflows and registries separately', () => {
    const workflow = createState()
    workflow.preHeatTreatmentLnkWorkflowMode = 'result'
    expect(getLnkWorkflowRowsRequest(workflow)).toEqual({
      scope: 'preHeatTreatmentResultCandidates',
      rowIds: null,
    })

    const registry = createState()
    registry.isPreHeatTreatmentResultManagerOpen = true
    registry.preHeatTreatmentResultManagerMode = 'request'
    registry.preHeatTreatmentResultManagerRowIds = [12]
    expect(getLnkWorkflowRowsRequest(registry)).toEqual({
      scope: 'preHeatTreatmentRequestRegistry',
      rowIds: [12],
    })
  })

  it('does not start a scoped request while the complete snapshot is active', () => {
    const state = createState()
    state.shouldLoadFullWeldRows = true
    state.isLnkResultModalOpen = true

    expect(getLnkWorkflowRowsRequest(state)).toBeNull()
  })

  it('loads the aggregate summary only for menus and request management', () => {
    const base = {
      isLnkReportActive: true,
      shouldLoadFullWeldRows: false,
      isLnkWorkflowMenuOpen: false,
      isLnkRequestModalOpen: false,
      isLnkRequestManagerOpen: false,
    }

    expect(shouldLoadLnkWorkflowSummary(base)).toBe(false)
    expect(shouldLoadLnkWorkflowSummary({ ...base, isLnkWorkflowMenuOpen: true })).toBe(true)
    expect(shouldLoadLnkWorkflowSummary({ ...base, isLnkRequestModalOpen: true })).toBe(true)
    expect(shouldLoadLnkWorkflowSummary({ ...base, isLnkRequestManagerOpen: true })).toBe(true)
    expect(shouldLoadLnkWorkflowSummary({
      ...base,
      isLnkWorkflowMenuOpen: true,
      shouldLoadFullWeldRows: true,
    })).toBe(false)
    expect(shouldLoadLnkWorkflowSummary({
      ...base,
      isLnkWorkflowMenuOpen: true,
      isLnkReportActive: false,
    })).toBe(false)
  })
})

function createState(): Parameters<typeof getLnkWorkflowRowsRequest>[0] {
  return {
    shouldLoadFullWeldRows: false,
    isLnkRequestModalOpen: false,
    isLnkRequestManagerOpen: false,
    isLnkResultModalOpen: false,
    isLnkResultManagerOpen: false,
    isLnkOfficialityModalOpen: false,
    preHeatTreatmentLnkWorkflowMode: null,
    isPreHeatTreatmentResultManagerOpen: false,
    preHeatTreatmentResultManagerMode: 'result',
    managedLnkResultOrderIds: null,
    preHeatTreatmentResultManagerRowIds: null,
  }
}
