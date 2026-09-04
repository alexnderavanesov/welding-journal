import { describe, expect, it } from 'vitest'

import {
  findFirstPstoChronologySaveBlockReason,
  getDispatcherPstoChronologyIssues,
  getPstoChronologyIssues,
} from '@/lib/psto-chronology-checks'
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

  it('enforces ZV-23 independently when ZV-24 is disabled', () => {
    const rows = [{
      id: 1,
      joint: 'F1',
      weldDate: '2026-07-10',
      pstoRequest: 'ПСТО-001',
      pstoRequestDate: '2026-07-11',
      pstoResult: 'проведено',
      pstoDate: '2026-07-09',
    }] as Parameters<typeof getPstoChronologyIssues>[0]
    const settings = {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      pstoResultRequestDateOrder: false,
    }

    expect(getPstoChronologyIssues(rows, settings)).toContainEqual(expect.objectContaining({
      kind: 'weld-after-result',
    }))
    expect(findFirstPstoChronologySaveBlockReason(rows, settings)).toContain('ЗВ-23')
  })

  it('does not apply ZV-24 request ordering when only ZV-23 is enabled', () => {
    const rows = [{
      id: 1,
      joint: 'F1',
      weldDate: '2026-07-10',
      pstoRequest: 'ПСТО-001',
      pstoRequestDate: '2026-07-09',
      pstoResult: 'проведено',
      pstoDate: '2026-07-11',
    }] as Parameters<typeof getPstoChronologyIssues>[0]

    expect(getPstoChronologyIssues(rows, {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      pstoResultRequestDateOrder: false,
    })).toEqual([])
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

  it('reports invalid dates in primary and repeat PSTO/TVMT cycles', () => {
    const issues = getDispatcherPstoChronologyIssues([{
      id: 1,
      joint: 'F1',
      pstoRequest: 'ПСТО-1',
      pstoRequestDate: '31.02.2026',
      pstoResult: 'проведено',
      pstoDate: '2023-12-31',
      tvmtRequest: 'ТВМТ-1',
      tvmtRequestDate: 'не дата',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '32.07.2026',
      pstoRepeatCycles: [{
        id: 2,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'ПСТО-2',
        pstoRequestDate: '30.02.2026',
        pstoResult: 'проведено',
        pstoDate: '2023-01-01',
        tvmtRequest: 'ТВМТ-2',
        tvmtRequestDate: 'ошибка',
        tvmtResult: 'годен',
        tvmtConclusionDate: '31.04.2026',
      }],
    }] as unknown as Parameters<typeof getDispatcherPstoChronologyIssues>[0])

    expect(issues.filter((issue) => issue.kind.endsWith('-invalid')).map((issue) => issue.kind)).toEqual([
      'request-date-invalid',
      'result-date-invalid',
      'tvmt-request-date-invalid',
      'tvmt-result-date-invalid',
      'request-date-invalid',
      'result-date-invalid',
      'tvmt-request-date-invalid',
      'tvmt-result-date-invalid',
    ])
    expect(issues.some((issue) => issue.kind.endsWith('-missing'))).toBe(false)
  })

  it('reports every missing part of pending PSTO and TVMT requests', () => {
    const issues = getDispatcherPstoChronologyIssues([{
      id: 1,
      joint: 'F1',
      weldDate: '2026-07-01',
      pstoRequest: 'ПСТО-1',
      tvmtRequestDate: '2026-07-04',
    }])

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'request-date-missing' }),
      expect.objectContaining({ kind: 'tvmt-request-name-missing' }),
    ]))
  })

  it('reports missing names and dates when cycle results exist without requests', () => {
    const issues = getDispatcherPstoChronologyIssues([{
      id: 1,
      joint: 'F1',
      weldDate: '2026-07-01',
      pstoResult: 'проведено',
      pstoDate: '2026-07-03',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-07-05',
    }])

    expect(issues.map((issue) => issue.kind)).toEqual([
      'request-date-missing',
      'request-name-missing',
      'tvmt-request-date-missing',
      'tvmt-request-name-missing',
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
