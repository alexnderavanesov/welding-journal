import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getDispatcherLnkChronologyIssues,
  getLnkChronologyIssues,
} from '@/lib/lnk-chronology-checks'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import {
  getLnkChronologyRootCauseActions,
  getNewChronologyRootCauseState,
} from '@/lib/workflow-root-cause-actions'

describe('workflow root-cause actions', () => {
  it('offers every exact correction for the mandatory F5 ZV-16 chronology conflict', () => {
    const row = f5Row()
    const issues = getLnkChronologyIssues([row], DEFAULT_SAVE_CHECK_SETTINGS)
      .filter((issue) => issue.kind === 'post-before-psto' || issue.kind === 'post-before-tvmt')
    const actions = getLnkChronologyRootCauseActions(issues)

    expect(actions.map((action) => action.label)).toEqual([
      'Исправить дату заявки ВИК',
      'Исправить дату ПСТО',
      'Исправить дату заключения ТВМТ',
    ])
    expect(actions[0]).toMatchObject({
      target: {
        kind: 'lnk-control',
        rowId: 5,
        stage: 'primary',
        methodCode: 'ВИК',
        documentPart: 'request',
        focus: 'date',
        documentName: 'Заявка ВИК',
        documentDate: '2026-08-09',
      },
    })
    expect(actions[1]).toMatchObject({
      target: {
        kind: 'psto-cycle',
        rowId: 5,
        sequence: 1,
        stage: 'pstoResult',
        focus: 'date',
        documentName: 'Диаграмма ПСТО',
        documentDate: '2026-08-29',
      },
    })
  })

  it('returns one action when an issue has only one valid correction place', () => {
    const issue = getDispatcherLnkChronologyIssues([{
      id: 7,
      joint: 'F7',
      vikRequest: 'Заявка ВИК',
      vikRequestDate: '31.02.2026',
    } as WeldRow]).find((candidate) => candidate.kind === 'request-date-invalid')

    expect(issue).toBeDefined()
    expect(getLnkChronologyRootCauseActions([issue!])).toEqual([
      expect.objectContaining({
        label: 'Исправить дату заявки ВИК',
        target: expect.objectContaining({
          kind: 'lnk-control',
          rowId: 7,
          documentPart: 'request',
          focus: 'date',
        }),
      }),
    ])
  })

  it('points a pre-TO conflict at the primary PSTO even when repeat cycles exist', () => {
    const row = f5Row({
      preHeatTreatmentControls: [{
        id: 71,
        weldJointId: 5,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-08-02',
        result: 'годен',
        conclusionName: 'Заключение ВИК до ТО',
        conclusionDate: '2026-08-31',
      }],
      pstoRepeatCycles: [{
        id: 72,
        weldJointId: 5,
        sequence: 2,
        pstoRequest: 'Повторная заявка ПСТО',
        pstoRequestDate: '2026-09-01',
        pstoResult: 'проведено',
        pstoDate: '2026-09-02',
        heatTreatmentDiagram: 'Повторная диаграмма ПСТО',
      }],
    })
    const issue = getLnkChronologyIssues([row], DEFAULT_SAVE_CHECK_SETTINGS)
      .find((candidate) => candidate.kind === 'pre-after-psto')

    expect(issue).toBeDefined()
    expect(getLnkChronologyRootCauseActions([issue!]).map((action) => action.target)).toEqual([
      expect.objectContaining({
        kind: 'lnk-control',
        rowId: 5,
        stage: 'beforeHeatTreatment',
        relationId: 71,
      }),
      expect.objectContaining({
        kind: 'psto-cycle',
        rowId: 5,
        sequence: 1,
        stage: 'pstoResult',
        documentName: 'Диаграмма ПСТО',
        documentDate: '2026-08-29',
      }),
    ])
  })

  it('deduplicates a shared correction and removes the ZV after a valid draft fix', () => {
    const previous = f5Row({ vikRequest: '', vikRequestDate: '' })
    const blocked = getNewChronologyRootCauseState({
      previousRows: [previous],
      proposedRows: [f5Row()],
      settings: DEFAULT_SAVE_CHECK_SETTINGS,
    })
    const fixed = getNewChronologyRootCauseState({
      previousRows: [previous],
      proposedRows: [f5Row({ vikRequestDate: '2026-08-30' })],
      settings: DEFAULT_SAVE_CHECK_SETTINGS,
    })

    expect(blocked.message).toContain('раньше даты ПСТО')
    expect(blocked.actions.filter((action) => action.label === 'Исправить дату заявки ВИК')).toHaveLength(1)
    expect(fixed).toEqual({ message: null, actions: [] })
  })
})

function f5Row(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 5,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'L-1',
    joint: 'F5',
    weldDate: '2026-08-01',
    pstoRequired: 'да',
    pstoRequest: 'Заявка ПСТО',
    pstoRequestDate: '2026-08-20',
    pstoResult: 'проведено',
    pstoDate: '2026-08-29',
    heatTreatmentDiagram: 'Диаграмма ПСТО',
    tvmtRequest: 'Заявка ТВМТ',
    tvmtRequestDate: '2026-08-29',
    tvmtResult: 'годен',
    tvmtConclusionDate: '2026-08-30',
    tvmtConclusion: 'Заключение ТВМТ',
    hasVik: 'да',
    vikRequest: 'Заявка ВИК',
    vikRequestDate: '2026-08-09',
    ...overrides,
  } as WeldRow
}
