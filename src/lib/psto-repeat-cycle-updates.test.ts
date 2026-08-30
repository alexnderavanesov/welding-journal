import { describe, expect, it } from 'vitest'

import {
  buildRepeatPstoRequestCycle,
  buildRepeatPstoResultCycle,
  buildRepeatTvmtRequestCycle,
  buildRepeatTvmtResultCycle,
} from '@/lib/psto-repeat-cycle-updates'

describe('repeat PSTO and TVMT cycle updates', () => {
  const failedPrimary = {
    id: 10,
    joint: 'F10',
    pstoRequired: 'да',
    pstoRequest: 'ПСТО-1',
    pstoRequestDate: '2026-08-01',
    pstoDate: '2026-08-02',
    pstoResult: 'проведено',
    tvmtRequest: 'ТВМТ-1',
    tvmtRequestDate: '2026-08-02',
    tvmtResult: 'не годен',
    tvmtConclusionDate: '2026-08-03',
    tvmtConclusion: 'ЗТВМТ-1',
  } as const

  it('starts a numbered repeat cycle only after failed TVMT', () => {
    expect(buildRepeatPstoRequestCycle({
      row: failedPrimary,
      requestName: 'ПСТО-2',
      requestDate: '2026-08-04',
    })).toMatchObject({
      weldJointId: 10,
      sequence: 2,
      pstoRequest: 'ПСТО-2',
      pstoRequestDate: '2026-08-04',
    })

    expect(() => buildRepeatPstoRequestCycle({
      row: { ...failedPrimary, tvmtResult: 'годен' },
      requestName: 'ПСТО-2',
      requestDate: '2026-08-04',
    })).toThrow('повторная ПСТО сейчас не требуется')
  })

  it('enforces request, PSTO and TVMT chronology in a repeat cycle', () => {
    const repeat = {
      id: 21,
      weldJointId: 10,
      sequence: 2,
      pstoRequest: 'ПСТО-2',
      pstoRequestDate: '2026-08-04',
    }
    const waitingPsto = { ...failedPrimary, pstoRepeatCycles: [repeat] }
    const completedPsto = buildRepeatPstoResultCycle({
      row: waitingPsto,
      pstoDate: '2026-08-05',
      diagramName: 'Диаграмма-2',
    })
    expect(completedPsto.pstoResult).toBe('проведено')

    const waitingTvmtRequest = {
      ...failedPrimary,
      pstoRepeatCycles: [{ ...completedPsto, id: 21 }],
    }
    const requestedTvmt = buildRepeatTvmtRequestCycle({
      row: waitingTvmtRequest,
      requestName: 'ТВМТ-2',
      requestDate: '2026-08-05',
    })
    expect(requestedTvmt.tvmtResult).toBe('ожидает НК')

    const waitingTvmt = {
      ...failedPrimary,
      pstoRepeatCycles: [{ ...requestedTvmt, id: 21 }],
    }
    const completedTvmt = buildRepeatTvmtResultCycle({
      row: waitingTvmt,
      controlDate: '2026-08-06',
      result: 'годен',
      conclusionName: 'ЗТВМТ-2',
    })
    expect(completedTvmt.tvmtResult).toBe('годен')
    expect(completedTvmt.tvmtConclusion).toBe('ЗТВМТ-2')
  })

  it('keeps duplicate controls outside repeat-cycle decisions', () => {
    expect(buildRepeatPstoRequestCycle({
      row: {
        ...failedPrimary,
        duplicateControls: [{
          id: 1,
          weldJointId: 10,
          method: 'РК',
          result: 'ремонт',
          controlDate: '2026-08-03',
          conclusion: 'Дубль',
          conclusionDate: '2026-08-03',
        }],
      },
      requestName: 'ПСТО-2',
      requestDate: '2026-08-04',
    }).sequence).toBe(2)
  })
})
