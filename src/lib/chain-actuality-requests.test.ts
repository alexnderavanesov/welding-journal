import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { getPendingActualityRequests } from './chain-actuality-requests'

describe('inactive chain request positions', () => {
  it('checks VIK, RK, UZK, PVK and TVMT requests independently', () => {
    expect(getPendingActualityRequests([{ id: 1, vikRequest: 'A', rkRequest: 'A', uzkRequest: 'A', pvkRequest: 'A', tvmtRequest: 'T' }])
      .map(position => position.method)).toEqual(['ВИК', 'РК', 'УЗК', 'ПВК', 'ТВМТ'])
  })
  it('removes only pending methods and stages; facts in another stage do not hide a pending request', () => {
    const row: WeldRow = { id: 1, joint: 'F1', rkRequest: 'KEEP', rkResult: 'ремонт', uzkRequest: 'REMOVE', uzkResult: 'ожидает НК',
      preHeatTreatmentControls: [
        { id: 11, weldJointId: 1, method: 'РК', requestName: 'PRE-PENDING', result: 'ожидает НК' },
        { id: 12, weldJointId: 1, method: 'УЗК', requestName: 'PRE-KEEP', result: 'годен' },
      ], pstoRepeatCycles: [
        { id: 21, weldJointId: 1, sequence: 2, pstoRequest: 'P2', pstoResult: 'проведено', tvmtRequest: 'T2', tvmtResult: 'ожидает НК' },
        { id: 22, weldJointId: 1, sequence: 3, pstoRequest: 'P3', pstoResult: 'ожидает', tvmtRequest: 'T3', tvmtResult: 'не годен' },
      ],
    }
    const before = structuredClone(row)
    expect(getPendingActualityRequests([row]).map(({ method, stage, relationId }) => [method, stage, relationId])).toEqual([
      ['УЗК', 'primary', 1], ['РК', 'beforeHeatTreatment', 11], ['ТВМТ', 'repeat', 21], ['ПСТО', 'repeat', 22],
    ])
    expect(row).toEqual(before)
  })
  it.each(['годен', 'ремонт', 'вырез', 'не годен', 'да', 'годен (отменен)', 'старый нестандартный результат'])('preserves factual/legacy result %s and its request', result => {
    expect(getPendingActualityRequests([{ id: 1, rkRequest: 'R', rkResult: result }])).toEqual([])
  })
  it.each([null, '', 'ожидает', 'ожидает НК', 'ожидает заявку'])('does not treat %s as performed work', result => {
    expect(getPendingActualityRequests([{ id: 1, rkRequest: 'R', rkResult: result }])).toHaveLength(1)
  })
  it.each(['ожидает ПСТО', ' ОЖИДАЕТ ПСТО '])('removes pending primary/repeat PSTO requests with %s', pstoResult => {
    const row: WeldRow = { id: 1, pstoRequest: 'P1', pstoResult,
      pstoRepeatCycles: [{ id: 21, weldJointId: 1, sequence: 2, pstoRequest: 'P2', pstoResult }],
    }
    expect(getPendingActualityRequests([row]).map(({ method, stage, relationId }) => [method, stage, relationId]))
      .toEqual([['ПСТО', 'primary', 1], ['ПСТО', 'repeat', 21]])
  })
  it.each(['ожидает ТВМТ', ' ОЖИДАЕТ ТВМТ '])('removes pending primary/repeat TVMT requests with %s', tvmtResult => {
    const row: WeldRow = { id: 1, tvmtRequest: 'T1', tvmtResult,
      pstoRepeatCycles: [{ id: 21, weldJointId: 1, sequence: 2, tvmtRequest: 'T2', tvmtResult }],
    }
    expect(getPendingActualityRequests([row]).map(({ method, stage, relationId }) => [method, stage, relationId]))
      .toEqual([['ТВМТ', 'primary', 1], ['ТВМТ', 'repeat', 21]])
  })
  it('preserves partial facts despite stage-specific waiting labels', () => {
    expect(getPendingActualityRequests([{ id: 1, pstoRequest: 'P1', pstoResult: 'ожидает ПСТО', pstoDate: '2026-11-06',
      tvmtRequest: 'T1', tvmtResult: 'ожидает ТВМТ', tvmtConclusion: 'C1',
      pstoRepeatCycles: [{ id: 21, weldJointId: 1, sequence: 2,
        pstoRequest: 'P2', pstoResult: 'ожидает ПСТО', heatTreatmentDiagram: 'D2',
        tvmtRequest: 'T2', tvmtResult: 'ожидает ТВМТ', tvmtConclusionDate: '2026-11-06' }],
    }])).toEqual([])
  })
  it.each(['нестандартный результат', 'ожидает проверки факта'])('preserves unknown PSTO/TVMT results %s', result => {
    expect(getPendingActualityRequests([{ id: 1, pstoRequest: 'P1', pstoResult: result,
      tvmtRequest: 'T1', tvmtResult: result,
      pstoRepeatCycles: [{ id: 21, weldJointId: 1, sequence: 2, pstoRequest: 'P2', pstoResult: result, tvmtRequest: 'T2', tvmtResult: result }],
    }])).toEqual([])
  })
  it('does not use stage-specific waiting labels for another method', () => {
    expect(getPendingActualityRequests([{ id: 1, rkRequest: 'R1', rkResult: 'ожидает ПСТО',
      pstoRequest: 'P1', pstoResult: 'ожидает ТВМТ', tvmtRequest: 'T1', tvmtResult: 'ожидает ПСТО',
    }])).toEqual([])
  })
  it.each([{ rkConclusion: 'C' }, { rkConclusionDate: '2026-11-06' }, { lnkDefectDescription: 'Дефект' }, { rkExposureConfirmedDiameter: 100 }])('preserves incomplete factual requisites %j', facts => {
    expect(getPendingActualityRequests([{ id: 1, rkRequest: 'R', ...facts }])).toEqual([])
  })
  it.each([{ pstoDate: '2026-11-06' }, { heatTreatmentDiagram: 'D1' }, { pstoResult: 'проведено' }])('preserves performed PSTO and legacy facts %j', facts => {
    expect(getPendingActualityRequests([{ id: 1, pstoRequest: 'P', ...facts }])).toEqual([])
  })
  it('includes a partial request with a date and no name, but no unrelated empty stages', () => {
    expect(getPendingActualityRequests([{ id: 1, pstoRequestDate: '2026-11-06', pstoResult: 'ожидает' }])).toEqual([
      { rowId: 1, method: 'ПСТО', stage: 'primary', relationId: 1, sequence: 1, name: '', date: '2026-11-06' },
    ])
  })
})
