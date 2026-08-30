import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  applyPstoCycleCorrection,
  getPstoCycleStageDeleteBlockReason,
} from '@/lib/psto-cycle-corrections'

describe('PSTO cycle corrections', () => {
  it('updates names and dates only when the complete timeline stays chronological', () => {
    const result = applyPstoCycleCorrection(makeRow(), {
      sequence: 1,
      stage: 'tvmtResult',
      action: 'update',
      date: '2026-08-06',
      name: 'ЗТВМТ-2',
      result: 'не годен',
    })

    expect(result.row).toEqual(expect.objectContaining({
      tvmtConclusionDate: '2026-08-06',
      tvmtConclusion: 'ЗТВМТ-2',
      tvmtResult: 'не годен',
      finalStatus: 'ожидает заявку',
    }))
    expect(() => applyPstoCycleCorrection(makeRow(), {
      sequence: 1,
      stage: 'pstoResult',
      action: 'update',
      date: '2026-08-07',
      name: 'Диаграмма-2',
    })).toThrow('не может быть раньше ПСТО')
  })

  it('deletes only the tail of the latest cycle without cascading', () => {
    const row = makeRow()
    expect(getPstoCycleStageDeleteBlockReason(row, 1, 'pstoResult')).toContain('Заключение ТВМТ')

    const withoutTvmtResult = applyPstoCycleCorrection(row, {
      sequence: 1,
      stage: 'tvmtResult',
      action: 'delete',
    }).row
    expect(withoutTvmtResult).toEqual(expect.objectContaining({
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-1',
      tvmtResult: 'ожидает НК',
      tvmtConclusion: null,
    }))
    expect(() => applyPstoCycleCorrection(row, {
      sequence: 1,
      stage: 'pstoResult',
      action: 'delete',
    })).toThrow('Цепочка удаляется только с конца')
  })

  it('does not allow an earlier cycle to become good while a repeat cycle exists', () => {
    const row = makeRow({
      tvmtResult: 'не годен',
      pstoRepeatCycles: [{
        id: 41,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Повтор-1',
        pstoRequestDate: '2026-08-07',
      }],
    })

    expect(() => applyPstoCycleCorrection(row, {
      sequence: 1,
      stage: 'tvmtResult',
      action: 'update',
      date: '2026-08-06',
      name: 'ЗТВМТ-1',
      result: 'годен',
    })).toThrow('допустим только после негодной ТВМТ')
    expect(getPstoCycleStageDeleteBlockReason(row, 1, 'tvmtResult')).toContain('последующие повторные циклы')
  })

  it('removes an empty repeat cycle only when its request is the chain tail', () => {
    const row = makeRow({
      tvmtResult: 'не годен',
      pstoRepeatCycles: [{
        id: 41,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Повтор-1',
        pstoRequestDate: '2026-08-07',
      }],
    })
    const result = applyPstoCycleCorrection(row, {
      sequence: 2,
      cycleId: 41,
      stage: 'pstoRequest',
      action: 'delete',
    })

    expect(result.deletedRepeatCycleId).toBe(41)
    expect(result.row.pstoRepeatCycles).toEqual([])
  })

  it('does not move the primary PSTO before completed pre-heat-treatment control', () => {
    const row = makeRow({
      pstoDate: '2026-08-05',
      tvmtRequestDate: '2026-08-06',
      tvmtConclusionDate: '2026-08-07',
      preHeatTreatmentControls: [{
        id: 11,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-08-02',
        result: 'годен',
        conclusionDate: '2026-08-04',
        conclusionName: 'ЗНК-ВИК-ДО-1',
      }],
    })

    expect(() => applyPstoCycleCorrection(row, {
      sequence: 1,
      stage: 'pstoResult',
      action: 'update',
      date: '2026-08-03',
      name: 'Диаграмма-2',
    })).toThrow('позже даты ПСТО')
  })

  it('does not move the latest good TVMT after an existing post-heat-treatment request', () => {
    const row = makeRow({
      hasVik: 'да',
      vikRequest: 'Заявка ВИК после ТО',
      vikRequestDate: '2026-08-07',
    })

    expect(() => applyPstoCycleCorrection(row, {
      sequence: 1,
      stage: 'tvmtResult',
      action: 'update',
      date: '2026-08-08',
      name: 'ЗТВМТ-2',
      result: 'годен',
    })).toThrow('раньше ТВМТ, завершившей цикл')
  })

  it('does not turn the latest TVMT into a failed result while post-control exists', () => {
    const row = makeRow({
      hasVik: 'да',
      vikRequest: 'Заявка ВИК после ТО',
      vikRequestDate: '2026-08-07',
    })

    expect(() => applyPstoCycleCorrection(row, {
      sequence: 1,
      stage: 'tvmtResult',
      action: 'update',
      date: '2026-08-06',
      name: 'ЗТВМТ-2',
      result: 'не годен',
    })).toThrow('до завершения цикла ПСТО и ТВМТ')
  })

  it('does not delete the cycle tail while post-TO LNK documents still depend on it', () => {
    const row = makeRow({
      hasVik: 'да',
      vikRequest: 'Заявка ВИК после ТО',
      vikRequestDate: '2026-08-07',
      vikResult: 'годен',
      vikConclusion: 'ЗНК ВИК после ТО',
      vikConclusionDate: '2026-08-07',
    })

    expect(getPstoCycleStageDeleteBlockReason(row, 1, 'tvmtResult'))
      .toContain('до завершения цикла ПСТО и ТВМТ')
    expect(() => applyPstoCycleCorrection(row, {
      sequence: 1,
      stage: 'tvmtResult',
      action: 'delete',
    })).toThrow('до завершения цикла ПСТО и ТВМТ')
  })

  it('does not expose deletion of the latest repeat TVMT while post-TO LNK depends on it', () => {
    const row = makeRow({
      tvmtResult: 'не годен',
      hasRk: 'да',
      rkRequest: 'Заявка РК после ТО',
      rkRequestDate: '2026-08-10',
      pstoRepeatCycles: [{
        id: 41,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Повтор-1',
        pstoRequestDate: '2026-08-07',
        pstoDate: '2026-08-08',
        pstoResult: 'проведено',
        heatTreatmentDiagram: 'Диаграмма-2',
        tvmtRequest: 'Заявка ТВМТ-2',
        tvmtRequestDate: '2026-08-08',
        tvmtResult: 'годен',
        tvmtConclusionDate: '2026-08-09',
        tvmtConclusion: 'ЗТВМТ-2',
      }],
    })

    expect(getPstoCycleStageDeleteBlockReason(row, 2, 'tvmtResult'))
      .toContain('до завершения цикла ПСТО и ТВМТ')
  })

  it('does not move the primary PSTO past the official cancellation date', () => {
    const row = makeRow({ pstoRequired: 'отменен', pstoCancellationDate: '2026-08-04' })

    expect(() => applyPstoCycleCorrection(row, {
      sequence: 1,
      stage: 'pstoResult',
      action: 'update',
      date: '2026-08-05',
      name: 'Диаграмма-2',
    })).toThrow('позже даты официальной отмены ПСТО')
  })
})

function makeRow(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    joint: 'F1',
    weldDate: '2026-08-01',
    pstoRequired: 'да',
    pstoRequest: 'Заявка ПСТО-1',
    pstoRequestDate: '2026-08-02',
    pstoDate: '2026-08-04',
    pstoResult: 'проведено',
    heatTreatmentDiagram: 'Диаграмма-1',
    tvmtRequest: 'Заявка ТВМТ-1',
    tvmtRequestDate: '2026-08-05',
    tvmtResult: 'годен',
    tvmtConclusionDate: '2026-08-06',
    tvmtConclusion: 'ЗТВМТ-1',
    pstoRepeatCycles: [],
    ...overrides,
  } as WeldRow
}
