import { describe, expect, it } from 'vitest'

import { getDispatcherPstoChronologyIssues, getPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

describe('psto chronology checks', () => {
  it('checks weld date, PSTO request date and PSTO result date order', () => {
    const rows = [
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-07-04',
        pstoRequest: 'ПСТО-08.07.26-001',
        pstoRequestDate: '2026-07-08',
        pstoResult: 'проведено',
        pstoDate: '2026-07-05',
      },
    ] as Parameters<typeof getPstoChronologyIssues>[0]

    expect(getPstoChronologyIssues(rows)[0]?.message).toBe(
      'Стык F1: дата результата ПСТО 05.07.2026 раньше даты заявки ПСТО 08.07.2026.',
    )
  })

  it('does not block PSTO chronology when the save check is disabled', () => {
    const rows = [
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-07-04',
        pstoRequest: 'ПСТО-01.07.26-001',
        pstoRequestDate: '2026-07-01',
      },
    ] as Parameters<typeof getPstoChronologyIssues>[0]

    expect(
      getPstoChronologyIssues(rows, {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        pstoResultRequestDateOrder: false,
      }),
    ).toEqual([])
  })

  it('shows every independent PSTO chronology problem in dispatcher diagnostics', () => {
    const issues = getDispatcherPstoChronologyIssues([
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-07-10',
        pstoRequest: 'ПСТО-001',
        pstoResult: 'проведено',
        pstoDate: '2026-07-05',
      },
    ])

    expect(issues.map((issue) => issue.kind)).toEqual([
      'request-date-missing',
      'weld-after-result',
    ])
  })

  it('checks TVMT and repeat PSTO dates across the complete cycle timeline', () => {
    const issues = getDispatcherPstoChronologyIssues([
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-07-01',
        pstoRequest: 'ПСТО-1',
        pstoRequestDate: '2026-07-02',
        pstoResult: 'проведено',
        pstoDate: '2026-07-03',
        tvmtRequest: 'ТВМТ-1',
        tvmtRequestDate: '2026-07-04',
        tvmtResult: 'не годен',
        tvmtConclusionDate: '2026-07-05',
        pstoRepeatCycles: [{
          id: 2,
          weldJointId: 1,
          sequence: 2,
          pstoRequest: 'ПСТО-2',
          pstoRequestDate: '2026-07-04',
          pstoResult: 'проведено',
          pstoDate: '2026-07-06',
          tvmtRequest: 'ТВМТ-2',
          tvmtRequestDate: '2026-07-05',
          tvmtResult: 'годен',
          tvmtConclusionDate: '2026-07-04',
        }],
      },
    ] as unknown as Parameters<typeof getDispatcherPstoChronologyIssues>[0])

    expect(issues.map((issue) => issue.kind)).toEqual([
      'previous-tvmt-after-repeat-request',
      'psto-after-tvmt-request',
      'psto-after-tvmt-result',
      'tvmt-request-after-result',
    ])
  })

  it('reports a repeat cycle that was not triggered by a failed previous TVMT', () => {
    const issues = getDispatcherPstoChronologyIssues([
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-07-01',
        pstoRequest: 'ПСТО-1',
        pstoRequestDate: '2026-07-02',
        pstoResult: 'проведено',
        pstoDate: '2026-07-03',
        tvmtRequest: 'ТВМТ-1',
        tvmtRequestDate: '2026-07-04',
        tvmtResult: 'годен',
        tvmtConclusionDate: '2026-07-05',
        pstoRepeatCycles: [{
          id: 2,
          weldJointId: 1,
          sequence: 2,
          pstoRequest: 'ПСТО-2',
          pstoRequestDate: '2026-07-06',
        }],
      },
    ] as unknown as Parameters<typeof getDispatcherPstoChronologyIssues>[0])

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      kind: 'repeat-without-failed-tvmt',
      message: 'Стык F1: цикл #2 создан без негодной ТВМТ предыдущего цикла.',
    })
  })

  it('accepts a repeat cycle after a failed previous TVMT', () => {
    const issues = getDispatcherPstoChronologyIssues([
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-07-01',
        pstoRequest: 'ПСТО-1',
        pstoRequestDate: '2026-07-02',
        pstoResult: 'проведено',
        pstoDate: '2026-07-03',
        tvmtRequest: 'ТВМТ-1',
        tvmtRequestDate: '2026-07-04',
        tvmtResult: 'не годен',
        tvmtConclusionDate: '2026-07-05',
        pstoRepeatCycles: [{
          id: 2,
          weldJointId: 1,
          sequence: 2,
          pstoRequest: 'ПСТО-2',
          pstoRequestDate: '2026-07-06',
        }],
      },
    ] as unknown as Parameters<typeof getDispatcherPstoChronologyIssues>[0])

    expect(issues).toEqual([])
  })

  it('does not treat duplicate controls as PSTO or TVMT cycle records', () => {
    const issues = getDispatcherPstoChronologyIssues([
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-07-10',
        duplicateControls: [{
          id: 10,
          weldJointId: 1,
          method: 'ТВМТ',
          result: 'годен',
          controlDate: '2026-07-01',
          conclusion: 'Дубль-ТВМТ-1',
          conclusionDate: '2026-07-01',
        }],
      },
    ] as unknown as Parameters<typeof getDispatcherPstoChronologyIssues>[0])

    expect(issues).toEqual([])
  })
})
