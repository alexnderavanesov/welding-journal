import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { getWorkflowDraftRootCauseState } from '@/lib/workflow-root-cause-preview'

describe('workflow draft root-cause preview', () => {
  it('detects every correction for a pre-TO request without mutating the source draft rows', () => {
    const source = row({
      pstoDate: '2026-08-10',
      pstoResult: 'проведено',
      heatTreatmentDiagram: 'Диаграмма ПСТО',
    })
    const state = getWorkflowDraftRootCauseState({
      rows: [source],
      updates: [{
        kind: 'pre-lnk-request',
        rowId: 1,
        methodCode: 'ВИК',
        documentName: 'Заявка ВИК до ТО',
        date: '2026-08-11',
      }],
      settings: DEFAULT_SAVE_CHECK_SETTINGS,
    })

    expect(state.message).toContain('позже даты ПСТО')
    expect(state.actions.map((action) => action.label)).toEqual([
      'Исправить дату заявки ВИК до ТО',
      'Исправить дату ПСТО',
    ])
    expect(state.actions[0].target).toMatchObject({
      kind: 'lnk-control',
      rowId: 1,
      stage: 'beforeHeatTreatment',
      documentPart: 'request',
      relationId: expect.any(Number),
    })
    expect(source.preHeatTreatmentControls).toBeUndefined()
  })

  it('returns separate exact request and result actions for a new PSTO ordering conflict', () => {
    const state = getWorkflowDraftRootCauseState({
      rows: [row({
        pstoRequest: 'Заявка ПСТО',
        pstoRequestDate: '2026-08-20',
      })],
      updates: [{
        kind: 'psto-stage',
        rowId: 1,
        sequence: 1,
        stage: 'pstoResult',
        documentName: 'Диаграмма ПСТО',
        date: '2026-08-19',
      }],
      settings: DEFAULT_SAVE_CHECK_SETTINGS,
    })

    expect(state.message).toContain('раньше даты заявки')
    expect(state.actions.map((action) => action.label)).toEqual([
      'Исправить дату заявки ПСТО',
      'Исправить дату ПСТО',
    ])
    expect(state.actions.map((action) => action.target)).toEqual([
      expect.objectContaining({ kind: 'psto-cycle', rowId: 1, sequence: 1, stage: 'pstoRequest' }),
      expect.objectContaining({ kind: 'psto-cycle', rowId: 1, sequence: 1, stage: 'pstoResult' }),
    ])
  })
})

function row(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'L-1',
    joint: 'F1',
    weldDate: '2026-08-01',
    ...overrides,
  } as WeldRow
}
