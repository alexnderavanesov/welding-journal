import { describe, expect, it } from 'vitest'

import {
  getPstoWorkflowRowsRequest,
  shouldLoadPstoWorkflowSummary,
} from '@/lib/psto-workflow-context'

describe('PSTO workflow context routing', () => {
  it.each([
    ['isPstoRequestModalOpen', 'requestCandidates'],
    ['isPstoResultModalOpen', 'resultCandidates'],
  ] as const)('maps %s to %s without a whole-report request', (stateKey, scope) => {
    const state = createState()
    state[stateKey] = true
    expect(getPstoWorkflowRowsRequest(state)).toEqual({ scope, rowIds: null })
  })

  it('waits for a request selection and then loads only that PSTO request', () => {
    expect(getPstoWorkflowRowsRequest({
      ...createState(),
      isPstoRequestManagerOpen: true,
    })).toBeNull()
    expect(getPstoWorkflowRowsRequest({
      ...createState(),
      isPstoRequestManagerOpen: true,
      managedRequestName: 'Заявка ПСТО-17',
      managedRequestDate: '2026-09-01',
    })).toEqual({
      scope: 'requestRegistry',
      rowIds: null,
      requestName: 'Заявка ПСТО-17',
      requestDate: '2026-09-01',
    })
  })

  it('bounds the all-history registry and loads selected histories only by id', () => {
    expect(getPstoWorkflowRowsRequest({
      ...createState(),
      isPstoResultManagerOpen: true,
      resultRegistryAll: true,
      resultRegistrySearch: 'LINE-7',
    })).toEqual({
      scope: 'resultRegistry',
      rowIds: null,
      search: 'LINE-7',
      limit: 500,
    })
    expect(getPstoWorkflowRowsRequest({
      ...createState(),
      isPstoResultManagerOpen: true,
      resultManagerRowIds: [7, 9],
    })).toEqual({ scope: 'resultRegistry', rowIds: [7, 9] })
  })

  it('pushes the selected PSTO request identity into result candidates', () => {
    expect(getPstoWorkflowRowsRequest({
      ...createState(),
      isPstoResultModalOpen: true,
      resultCandidateRequestName: 'ПСТО-17',
      resultCandidateRequestDate: '2026-09-22',
    })).toEqual({
      scope: 'resultCandidates',
      rowIds: null,
      requestName: 'ПСТО-17',
      requestDate: '2026-09-22',
    })
  })

  it('routes repeat and TVMT dialogs to independent candidate scopes', () => {
    expect(getPstoWorkflowRowsRequest({
      ...createState(),
      pstoRepeatWorkflowMode: 'result',
      repeatCandidateSearch: 'LINE-17',
    })).toEqual({ scope: 'resultCandidates', rowIds: null, search: 'LINE-17' })
    expect(getPstoWorkflowRowsRequest({
      ...createState(),
      tvmtWorkflowMode: 'request',
      tvmtCandidateSearch: 'J017',
    })).toEqual({ scope: 'tvmtRequestCandidates', rowIds: null, search: 'J017' })
  })

  it('loads only the edited row for a direct field edit', () => {
    expect(getPstoWorkflowRowsRequest({
      ...createState(),
      fieldEditingRowId: 42,
    })).toEqual({ scope: 'fieldRows', rowIds: [42] })
  })

  it('does not start scoped requests while the complete snapshot is active', () => {
    expect(getPstoWorkflowRowsRequest({
      ...createState(),
      shouldLoadFullWeldRows: true,
      isPstoRequestModalOpen: true,
    })).toBeNull()
  })

  it('loads only the aggregate summary when the workflow menu is open', () => {
    expect(shouldLoadPstoWorkflowSummary({
      isPstoReportActive: true,
      shouldLoadFullWeldRows: false,
      isPstoWorkflowMenuOpen: true,
    })).toBe(true)
    expect(shouldLoadPstoWorkflowSummary({
      isPstoReportActive: true,
      shouldLoadFullWeldRows: false,
      isPstoWorkflowMenuOpen: false,
    })).toBe(false)
  })
})

function createState(): Parameters<typeof getPstoWorkflowRowsRequest>[0] {
  return {
    shouldLoadFullWeldRows: false,
    isPstoRequestModalOpen: false,
    isPstoRequestManagerOpen: false,
    isPstoResultModalOpen: false,
    isPstoResultManagerOpen: false,
    tvmtWorkflowMode: null,
    pstoRepeatWorkflowMode: null,
    fieldEditingRowId: null,
    resultManagerRowIds: [],
    resultRegistryAll: false,
    resultRegistrySearch: '',
    resultRegistryLimit: 500,
    managedRequestName: '',
    managedRequestDate: '',
    requestCandidateRowIds: [],
    requestCandidateSearch: '',
    resultCandidateRowIds: [],
    resultCandidateSearch: '',
    resultCandidateRequestName: '',
    resultCandidateRequestDate: '',
    otherCandidateRowIds: [],
    repeatCandidateSearch: '',
    tvmtCandidateSearch: '',
    repeatCandidateRequestName: '',
    repeatCandidateRequestDate: '',
    tvmtCandidateRequestName: '',
    tvmtCandidateRequestDate: '',
  }
}
