import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getCurrentWorkflowRequestIdentity,
  getWorkflowRootCauseDestination,
} from '@/lib/workflow-root-cause-navigation'
import type { WorkflowRootCauseTarget } from '@/lib/workflow-root-cause-actions'

describe('workflow root-cause navigation', () => {
  it.each([
    [{ kind: 'weld-field', rowId: 11, fieldKey: 'weldDate' }, 'weld-form'],
    [{ kind: 'duplicate-control', rowId: 11, relationId: 4 }, 'duplicate-control'],
    [{
      kind: 'lnk-control', rowId: 11, stage: 'primary', methodCode: 'ВИК',
      documentPart: 'request', focus: 'date',
    }, 'lnk-request-manager'],
    [{
      kind: 'lnk-control', rowId: 11, stage: 'beforeHeatTreatment', methodCode: 'ВИК',
      documentPart: 'conclusion', focus: 'date', relationId: 8,
    }, 'pre-lnk-manager'],
    [{
      kind: 'psto-cycle', rowId: 11, sequence: 1, stage: 'pstoRequest', focus: 'date',
    }, 'psto-request-manager'],
    [{
      kind: 'psto-cycle', rowId: 11, sequence: 1, stage: 'pstoResult', focus: 'date',
    }, 'psto-result-manager'],
    [{
      kind: 'psto-cycle', rowId: 11, sequence: 2, stage: 'pstoRequest', focus: 'date',
    }, 'psto-result-manager'],
  ] as Array<[WorkflowRootCauseTarget, string]>)('routes %o to %s', (target, destination) => {
    expect(getWorkflowRootCauseDestination(target, row())).toBe(destination)
  })

  it('opens an exact existing conclusion in the manager', () => {
    expect(getWorkflowRootCauseDestination({
      kind: 'lnk-control',
      rowId: 11,
      stage: 'primary',
      methodCode: 'ВИК',
      documentPart: 'conclusion',
      focus: 'date',
    }, row({ vikResult: 'годен' }))).toBe('lnk-result-manager')
  })

  it('opens the result-entry dialog when the requested LNK result does not exist yet', () => {
    expect(getWorkflowRootCauseDestination({
      kind: 'lnk-control',
      rowId: 11,
      stage: 'primary',
      methodCode: 'ВИК',
      documentPart: 'result',
      focus: 'result',
    }, row({ vikResult: 'ожидает НК' }))).toBe('lnk-result-dialog')
  })

  it('opens request creation when the LNK request identity is missing before a result', () => {
    expect(getWorkflowRootCauseDestination({
      kind: 'lnk-control',
      rowId: 11,
      stage: 'primary',
      methodCode: 'ВИК',
      documentPart: 'request',
      focus: 'name',
    }, row({ vikRequest: null, vikRequestDate: null, vikResult: 'ожидает НК' }))).toBe('lnk-request-dialog')
  })

  it('opens result management to repair a missing LNK request identity after a final result', () => {
    expect(getWorkflowRootCauseDestination({
      kind: 'lnk-control',
      rowId: 11,
      stage: 'primary',
      methodCode: 'ВИК',
      documentPart: 'request',
      focus: 'date',
    }, row({ vikRequest: null, vikRequestDate: null, vikResult: 'годен' }))).toBe('lnk-result-manager')
  })

  it('opens ПСТО result management when the first-cycle request identity is missing', () => {
    expect(getWorkflowRootCauseDestination({
      kind: 'psto-cycle',
      rowId: 11,
      sequence: 1,
      stage: 'pstoRequest',
      focus: 'name',
    }, row({ pstoRequest: null, pstoRequestDate: null }))).toBe('psto-result-manager')
  })

  it('uses the current row identity instead of stale action metadata', () => {
    expect(getCurrentWorkflowRequestIdentity({
      kind: 'lnk-control',
      rowId: 11,
      stage: 'primary',
      methodCode: 'ВИК',
      documentPart: 'request',
      focus: 'date',
      documentName: 'Старая заявка',
      documentDate: '2026-08-01',
    }, row({
      vikRequest: 'Текущая заявка',
      vikRequestDate: '2026-08-02',
    }))).toEqual({ name: 'Текущая заявка', date: '2026-08-02' })

    expect(getCurrentWorkflowRequestIdentity({
      kind: 'psto-cycle',
      rowId: 11,
      sequence: 1,
      stage: 'pstoRequest',
      focus: 'date',
      documentName: 'Старая заявка ПСТО',
      documentDate: '2026-08-03',
    }, row({
      pstoRequest: 'Текущая заявка ПСТО',
      pstoRequestDate: '2026-08-04',
    }))).toEqual({ name: 'Текущая заявка ПСТО', date: '2026-08-04' })
  })

  it('keeps a current request with a missing date addressable by its name', () => {
    expect(getCurrentWorkflowRequestIdentity({
      kind: 'lnk-control',
      rowId: 11,
      stage: 'primary',
      methodCode: 'ВИК',
      documentPart: 'request',
      focus: 'date',
    }, row({ vikRequest: 'Заявка без даты', vikRequestDate: null }))).toEqual({
      name: 'Заявка без даты',
      date: '',
    })
  })
})

function row(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 11,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'L-1',
    joint: 'F11',
    vikRequest: 'Заявка ВИК',
    vikRequestDate: '2026-08-01',
    pstoRequest: 'Заявка ПСТО',
    pstoRequestDate: '2026-08-02',
    ...overrides,
  } as WeldRow
}
