import { describe, expect, it } from 'vitest'

import {
  getLnkWorkflowRowsRequest,
  shouldLoadLnkWorkflowRequestSummary,
  shouldLoadLnkWorkflowSummary,
} from '@/lib/lnk-workflow-context'

describe('LNK workflow context routing', () => {
  it.each([
    ['isLnkRequestModalOpen', 'requestCandidates'],
    ['isLnkResultModalOpen', 'resultCandidates'],
    ['isLnkOfficialityModalOpen', 'officialityCandidates'],
  ] as const)('maps %s to %s without a whole-report request', (stateKey, scope) => {
    const state = createState()
    state[stateKey] = true

    expect(getLnkWorkflowRowsRequest(state)).toEqual({ scope, rowIds: null })
  })

  it('bounds and filters the all-results registry without affecting selected-row registries', () => {
    const all = createState()
    all.isLnkResultManagerOpen = true
    all.resultRegistrySearch = 'LINE-7'
    all.resultRegistryFilter = 'ремонт'
    expect(getLnkWorkflowRowsRequest(all)).toEqual({
      scope: 'resultRegistry',
      rowIds: null,
      search: 'LINE-7',
      resultFilter: 'ремонт',
      limit: 500,
    })

    const selected = createState()
    selected.isLnkResultManagerOpen = true
    selected.managedLnkResultOrderIds = [9, 4]
    selected.resultRegistrySearch = 'ignored'
    expect(getLnkWorkflowRowsRequest(selected)).toEqual({
      scope: 'resultRegistry',
      rowIds: [9, 4],
    })
  })

  it('loads only the selected request document in the request manager', () => {
    const state = createState()
    state.isLnkRequestManagerOpen = true
    state.managedLnkRequestName = 'Заявка 17'
    state.managedLnkRequestDate = '2026-09-22'

    expect(getLnkWorkflowRowsRequest(state)).toEqual({
      scope: 'requestRegistry',
      rowIds: null,
      requestName: 'Заявка 17',
      requestDate: '2026-09-22',
    })
  })

  it('does not load every request row before a request is selected', () => {
    const state = createState()
    state.isLnkRequestManagerOpen = true

    expect(getLnkWorkflowRowsRequest(state)).toBeNull()
  })

  it('keeps candidate query identities independent from checkbox selection', () => {
    const state = createState()
    state.isLnkRequestModalOpen = true

    const first = getLnkWorkflowRowsRequest(state)
    const second = getLnkWorkflowRowsRequest(state)

    expect(first).toEqual({ scope: 'requestCandidates', rowIds: null })
    expect(second).toEqual(first)
  })

  it('pushes the selected method and request identity into result candidate SQL', () => {
    const state = createState()
    state.isLnkResultModalOpen = true
    state.resultCandidateMethodKey = 'rkRequest'
    state.resultCandidateRequestName = 'РК-17'
    state.resultCandidateRequestDate = '2026-09-22'

    expect(getLnkWorkflowRowsRequest(state)).toEqual({
      scope: 'resultCandidates',
      rowIds: null,
      methodKeys: ['rkRequest'],
      requestName: 'РК-17',
      requestDate: '2026-09-22',
    })
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
    workflow.otherCandidateSearch = 'LINE-17'
    expect(getLnkWorkflowRowsRequest(workflow)).toEqual({
      scope: 'preHeatTreatmentResultCandidates',
      rowIds: null,
      search: 'LINE-17',
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

  it('loads only the edited row for a direct field edit', () => {
    const state = createState()
    state.fieldEditingRowId = 42

    expect(getLnkWorkflowRowsRequest(state)).toEqual({
      scope: 'fieldRows',
      rowIds: [42],
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
    }

    expect(shouldLoadLnkWorkflowSummary(base)).toBe(false)
    expect(shouldLoadLnkWorkflowSummary({ ...base, isLnkWorkflowMenuOpen: true })).toBe(true)
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

  it('loads request document options separately from the menu counters', () => {
    const base = {
      isLnkReportActive: true,
      shouldLoadFullWeldRows: false,
      isLnkRequestModalOpen: false,
      isLnkRequestManagerOpen: false,
      isLnkFieldEditing: false,
    }

    expect(shouldLoadLnkWorkflowRequestSummary(base)).toBe(false)
    expect(shouldLoadLnkWorkflowRequestSummary({ ...base, isLnkRequestModalOpen: true })).toBe(true)
    expect(shouldLoadLnkWorkflowRequestSummary({ ...base, isLnkRequestManagerOpen: true })).toBe(true)
    expect(shouldLoadLnkWorkflowRequestSummary({ ...base, isLnkFieldEditing: true })).toBe(true)
    expect(shouldLoadLnkWorkflowRequestSummary({
      ...base,
      isLnkRequestModalOpen: true,
      shouldLoadFullWeldRows: true,
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
    fieldEditingRowId: null,
    managedLnkRequestName: '',
    managedLnkRequestDate: '',
    requestCandidateRowIds: [],
    requestCandidateSearch: '',
    requestCandidateMethodKeys: [],
    resultCandidateRowIds: [],
    resultCandidateSearch: '',
    resultCandidateMethodKey: '',
    resultCandidateRequestName: '',
    resultCandidateRequestDate: '',
    allowPrimaryBeforePreviousStagesComplete: false,
    officialityCandidateRowIds: [],
    officialityCandidateSearch: '',
    otherCandidateRowIds: [],
    otherCandidateSearch: '',
    otherCandidateMethodKeys: [],
    otherCandidateRequestName: '',
    otherCandidateRequestDate: '',
    resultRegistrySearch: '',
    resultRegistryFilter: 'all',
    resultRegistryLimit: 500,
  }
}
