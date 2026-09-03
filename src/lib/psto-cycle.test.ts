import { describe, expect, it } from 'vitest'

import {
  buildPstoCycleTimeline,
  hasAnyPstoCycle,
  hasPrimaryPstoCycle,
  hasPstoCycleExecutionHistory,
  hasPstoExecutionHistory,
} from '@/lib/psto-cycle'

describe('PSTO cycle timeline', () => {
  it('keeps existing PSTO and TVMT fields as the first cycle', () => {
    const row = {
      pstoRequired: 'да',
      pstoRequest: 'ПСТО-001',
      pstoRequestDate: '2026-08-01',
      pstoDate: '2026-08-02',
      heatTreatmentDiagram: 'ПСТО-Д-001',
      pstoResult: 'проведено',
      tvmtRequest: 'ТВМТ-001',
      tvmtRequestDate: '2026-08-02',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-03',
      tvmtConclusion: 'ЗНК-ТВМТ-001',
    }

    expect(buildPstoCycleTimeline(row)).toEqual([{
      source: 'primary',
      sequence: 1,
      pstoRequest: 'ПСТО-001',
      pstoRequestDate: '2026-08-01',
      pstoDate: '2026-08-02',
      heatTreatmentDiagram: 'ПСТО-Д-001',
      pstoResult: 'проведено',
      pstoNote: '',
      tvmtRequest: 'ТВМТ-001',
      tvmtRequestDate: '2026-08-02',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-03',
      tvmtConclusion: 'ЗНК-ТВМТ-001',
    }])
  })

  it('creates an empty first cycle for an assigned PSTO position', () => {
    expect(hasPrimaryPstoCycle({ pstoRequired: 'да' })).toBe(true)
    expect(buildPstoCycleTimeline({ pstoRequired: 'да' })[0]).toMatchObject({
      source: 'primary',
      sequence: 1,
      pstoResult: '',
      tvmtResult: '',
    })
  })

  it('adds repeat cycles after the primary cycle in sequence order', () => {
    const timeline = buildPstoCycleTimeline(
      { pstoRequired: 'да', pstoResult: 'проведено', tvmtResult: 'требуется повторная ПСТО' },
      [
        { id: 30, weldJointId: 1, sequence: 3, pstoRequest: 'ПСТО-003' },
        { id: 20, weldJointId: 1, sequence: 2, pstoRequest: 'ПСТО-002' },
      ],
    )

    expect(timeline.map((cycle) => [cycle.source, cycle.sequence, cycle.pstoRequest])).toEqual([
      ['primary', 1, ''],
      ['repeat', 2, 'ПСТО-002'],
      ['repeat', 3, 'ПСТО-003'],
    ])
  })

  it('recognizes a valid repeat cycle even when legacy primary fields are empty', () => {
    const repeatCycles = [{ id: 20, weldJointId: 1, sequence: 2, pstoRequest: 'ПСТО-002' }]

    expect(hasAnyPstoCycle({}, repeatCycles)).toBe(true)
    expect(hasAnyPstoCycle({}, [{ ...repeatCycles[0], sequence: 1 }])).toBe(false)
  })

  it('does not expose an unassigned empty row as a PSTO cycle', () => {
    expect(hasPrimaryPstoCycle({})).toBe(false)
    expect(buildPstoCycleTimeline({})).toEqual([])
  })

  it('does not mistake a cancelled derived waiting status for a real PSTO cycle', () => {
    for (const pstoResult of ['ожидает', 'ожидает заявку', 'отменен']) {
      const row = { pstoRequired: 'отменен', pstoResult }
      expect(hasPrimaryPstoCycle(row)).toBe(false)
      expect(buildPstoCycleTimeline(row)).toEqual([])
    }
  })

  it('keeps a physically started primary PSTO cycle visible after cancellation', () => {
    expect(buildPstoCycleTimeline({
      pstoRequired: 'отменен',
      pstoRequest: 'ПСТО-001',
      pstoDate: '2026-08-02',
      pstoResult: 'проведено',
    })).toEqual([
      expect.objectContaining({
        source: 'primary',
        sequence: 1,
        pstoRequest: 'ПСТО-001',
        pstoResult: 'проведено',
      }),
    ])

    expect(buildPstoCycleTimeline({
      pstoRequired: 'отменен',
      pstoRequest: 'ПСТО-001',
    })).toEqual([])
  })

  it('does not treat derived waiting labels as performed PSTO history', () => {
    expect(hasPstoExecutionHistory({
      pstoResult: 'ожидает заявку',
      tvmtResult: 'ожидает НК',
    })).toBe(false)
    expect(hasPstoExecutionHistory({ tvmtResult: 'годен' })).toBe(true)
  })

  it('distinguishes a request-only repeat from a physically started repeat', () => {
    expect(hasPstoCycleExecutionHistory({
      pstoDate: null,
      heatTreatmentDiagram: null,
      pstoResult: null,
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
    })).toBe(false)
    expect(hasPstoCycleExecutionHistory({
      pstoDate: '2026-08-08',
      heatTreatmentDiagram: null,
      pstoResult: 'проведено',
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
    })).toBe(true)
  })

  it('ignores invalid repeat sequence values defensively', () => {
    expect(buildPstoCycleTimeline({}, [
      { id: 1, weldJointId: 1, sequence: 1, pstoResult: 'проведено' },
      { id: 2, weldJointId: 1, sequence: 1.5, pstoResult: 'проведено' },
    ])).toEqual([])
  })
})
