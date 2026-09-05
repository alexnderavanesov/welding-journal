import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  applyPstoCycleCorrection,
  applyPstoTvmtCorrectionWithLaterCycleRemoval,
  getPstoCycleStageDeleteBlockReason,
  getPstoCycleStageInlineLabel,
} from '@/lib/psto-cycle-corrections'

describe('PSTO cycle corrections', () => {
  it('keeps PSTO and TVMT abbreviations uppercase in inline stage labels', () => {
    expect(getPstoCycleStageInlineLabel('pstoResult')).toBe('результат ПСТО')
    expect(getPstoCycleStageInlineLabel('tvmtResult')).toBe('заключение ТВМТ')
  })

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

  it('repairs a missing earlier stage only when a later stage proves that it existed', () => {
    const malformedRow = makeRow({
      pstoRequest: null,
      pstoRequestDate: null,
    })

    const repaired = applyPstoCycleCorrection(malformedRow, {
      sequence: 1,
      stage: 'pstoRequest',
      action: 'update',
      date: '2026-08-02',
      name: 'Заявка ПСТО восстановлена',
    }).row

    expect(repaired).toEqual(expect.objectContaining({
      pstoRequest: 'Заявка ПСТО восстановлена',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'проведено',
    }))

    expect(() => applyPstoCycleCorrection(makeRow({
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
    }), {
      sequence: 1,
      stage: 'tvmtRequest',
      action: 'update',
      date: '2026-08-06',
      name: 'Новая заявка ТВМТ',
    })).toThrow('еще не создан')
  })

  it('keeps PSTO date format mandatory when other date rules are disabled', () => {
    const settings = {
      ...makeSaveCheckSettings(),
      pstoResultDateRequired: true,
      pstoResultDateFormat: false,
      pstoResultDateAfterWeldDate: false,
      pstoResultRequestDateOrder: false,
    }
    expect(() => applyPstoCycleCorrection(makeRow(), {
      sequence: 1,
      stage: 'pstoResult',
      action: 'update',
      date: 'дата уточняется',
      name: 'Диаграмма-2',
    }, settings)).toThrow('корректную дату ПСТО')
  })

  it('rejects malformed dates when correcting request and TVMT stages', () => {
    expect(() => applyPstoCycleCorrection(makeRow(), {
      sequence: 1,
      stage: 'pstoRequest',
      action: 'update',
      date: 'не дата',
      name: 'Заявка ПСТО-2',
    })).toThrow('корректную дату документа')

    expect(() => applyPstoCycleCorrection(makeRow(), {
      sequence: 1,
      stage: 'tvmtResult',
      action: 'update',
      date: 'не дата',
      name: 'ЗТВМТ-2',
      result: 'годен',
    })).toThrow('корректную дату документа')
  })

  it('rejects dates before the system minimum in cycle corrections', () => {
    expect(() => applyPstoCycleCorrection(makeRow(), {
      sequence: 1,
      stage: 'pstoRequest',
      action: 'update',
      date: '2023-12-31',
      name: 'Заявка ПСТО-2',
    })).toThrow('не может быть раньше 01.01.2024')

    expect(() => applyPstoCycleCorrection(makeRow(), {
      sequence: 1,
      stage: 'pstoResult',
      action: 'update',
      date: '2023-12-31',
      name: 'Диаграмма-2',
    })).toThrow('Дата результата ПСТО не может быть раньше 01.01.2024')
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
    })).toThrow('сначала удалите этапы цикла #2 с конца цепочки')
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

  it('atomically corrects failed TVMT and removes every dependent later cycle while preserving valid post-TO LNK', () => {
    const row = makeRow({
      tvmtResult: 'не годен',
      hasVik: 'да',
      vikRequest: 'Заявка ВИК после ТО',
      vikRequestDate: '2026-08-11',
      vikResult: 'годен',
      vikConclusion: 'ЗНК ВИК после ТО',
      vikConclusionDate: '2026-08-11',
      pstoRepeatCycles: [
        {
          id: 41,
          weldJointId: 1,
          sequence: 2,
          pstoRequest: 'Повтор-2',
          pstoRequestDate: '2026-08-07',
          pstoDate: '2026-08-08',
          pstoResult: 'проведено',
          heatTreatmentDiagram: 'Диаграмма-2',
          tvmtRequest: 'Заявка ТВМТ-2',
          tvmtRequestDate: '2026-08-08',
          tvmtResult: 'не годен',
          tvmtConclusionDate: '2026-08-09',
          tvmtConclusion: 'ЗТВМТ-2',
        },
        {
          id: 42,
          weldJointId: 1,
          sequence: 3,
          pstoRequest: 'Повтор-3',
          pstoRequestDate: '2026-08-09',
          pstoDate: '2026-08-10',
          pstoResult: 'проведено',
          heatTreatmentDiagram: 'Диаграмма-3',
          tvmtRequest: 'Заявка ТВМТ-3',
          tvmtRequestDate: '2026-08-10',
          tvmtResult: 'годен',
          tvmtConclusionDate: '2026-08-10',
          tvmtConclusion: 'ЗТВМТ-3',
        },
      ],
    })

    const result = applyPstoTvmtCorrectionWithLaterCycleRemoval(row, {
      sequence: 1,
      date: '2026-08-06',
      name: 'ЗТВМТ-1 исправлено',
      result: 'годен',
    })

    expect(result.deletedRepeatCycles.map((cycle) => cycle.id)).toEqual([41, 42])
    expect(result.row).toEqual(expect.objectContaining({
      tvmtResult: 'годен',
      tvmtConclusion: 'ЗТВМТ-1 исправлено',
      vikRequest: 'Заявка ВИК после ТО',
      vikConclusion: 'ЗНК ВИК после ТО',
      pstoRepeatCycles: [],
    }))
  })

  it('rejects the atomic correction when the corrected TVMT date would invalidate preserved post-TO LNK', () => {
    const row = makeRow({
      tvmtResult: 'не годен',
      hasVik: 'да',
      vikRequest: 'Заявка ВИК после ТО',
      vikRequestDate: '2026-08-10',
      pstoRepeatCycles: [{
        id: 41,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Повтор-2',
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

    expect(() => applyPstoTvmtCorrectionWithLaterCycleRemoval(row, {
      sequence: 1,
      date: '2026-08-11',
      name: 'ЗТВМТ-1 исправлено',
      result: 'годен',
    })).toThrow('раньше ТВМТ, завершившей цикл')
    expect(row.pstoRepeatCycles).toHaveLength(1)
    expect(row.tvmtResult).toBe('не годен')
  })

  it('can correct a repeat TVMT and remove only the cycles that follow it', () => {
    const row = makeRow({
      tvmtResult: 'не годен',
      hasRk: 'да',
      rkRequest: 'Заявка РК после ТО',
      rkRequestDate: '2026-08-12',
      pstoRepeatCycles: [
        {
          id: 41,
          weldJointId: 1,
          sequence: 2,
          pstoRequest: 'Повтор-2',
          pstoRequestDate: '2026-08-07',
          pstoDate: '2026-08-08',
          pstoResult: 'проведено',
          heatTreatmentDiagram: 'Диаграмма-2',
          tvmtRequest: 'Заявка ТВМТ-2',
          tvmtRequestDate: '2026-08-08',
          tvmtResult: 'не годен',
          tvmtConclusionDate: '2026-08-09',
          tvmtConclusion: 'ЗТВМТ-2',
        },
        {
          id: 42,
          weldJointId: 1,
          sequence: 3,
          pstoRequest: 'Повтор-3',
          pstoRequestDate: '2026-08-09',
          pstoDate: '2026-08-10',
          pstoResult: 'проведено',
          heatTreatmentDiagram: 'Диаграмма-3',
          tvmtRequest: 'Заявка ТВМТ-3',
          tvmtRequestDate: '2026-08-10',
          tvmtResult: 'годен',
          tvmtConclusionDate: '2026-08-11',
          tvmtConclusion: 'ЗТВМТ-3',
        },
      ],
    })

    const result = applyPstoTvmtCorrectionWithLaterCycleRemoval(row, {
      sequence: 2,
      cycleId: 41,
      date: '2026-08-09',
      name: 'ЗТВМТ-2 исправлено',
      result: 'годен',
    })

    expect(result.deletedRepeatCycles.map((cycle) => cycle.id)).toEqual([42])
    expect(result.repeatCycle).toEqual(expect.objectContaining({
      id: 41,
      sequence: 2,
      tvmtResult: 'годен',
      tvmtConclusion: 'ЗТВМТ-2 исправлено',
    }))
    expect(result.row.pstoRepeatCycles).toHaveLength(1)
    expect(result.row.rkRequest).toBe('Заявка РК после ТО')
  })

  it('requires the exact repeat cycle identity before changing its history', () => {
    const row = makeRow({
      tvmtResult: 'не годен',
      pstoRepeatCycles: [{
        id: 41,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Повтор-2',
        pstoRequestDate: '2026-08-07',
        pstoDate: '2026-08-08',
        pstoResult: 'проведено',
        heatTreatmentDiagram: 'Диаграмма-2',
        tvmtRequest: 'Заявка ТВМТ-2',
        tvmtRequestDate: '2026-08-08',
        tvmtResult: 'не годен',
        tvmtConclusionDate: '2026-08-09',
        tvmtConclusion: 'ЗТВМТ-2',
      }, {
        id: 42,
        weldJointId: 1,
        sequence: 3,
        pstoRequest: 'Повтор-3',
        pstoRequestDate: '2026-08-10',
      }],
    })

    expect(() => applyPstoTvmtCorrectionWithLaterCycleRemoval(row, {
      sequence: 2,
      date: '2026-08-09',
      name: 'ЗТВМТ-2 исправлено',
      result: 'годен',
    })).toThrow('Не указан идентификатор повторного цикла')
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

  it('does not move a repeat PSTO past the official cancellation date', () => {
    const row = makeRow({
      pstoRequired: 'отменен',
      pstoCancellationDate: '2026-08-10',
      tvmtResult: 'не годен',
      pstoRepeatCycles: [{
        id: 41,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Повтор-2',
        pstoRequestDate: '2026-08-07',
        pstoDate: '2026-08-08',
        pstoResult: 'проведено',
        heatTreatmentDiagram: 'Диаграмма-2',
      }],
    })

    expect(() => applyPstoCycleCorrection(row, {
      sequence: 2,
      cycleId: 41,
      stage: 'pstoResult',
      action: 'update',
      date: '2026-08-11',
      name: 'Диаграмма-2 исправлена',
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

function makeSaveCheckSettings() {
  return {
    officialRegistry: true,
    officialArchive: true,
    officialNaksDate: true,
    officialSuspension: true,
    officialWeldingMethod: true,
    officialMaterialGroup: true,
    officialDiameter: true,
    officialThickness: true,
    officialDls: true,
    requiredRootStampWithWeldDate: true,
    requiredMaterialGroupWithWeldDate: true,
    requiredConnectionTypeWithWeldDate: true,
    requiredWeldingMethodWithWeldDate: true,
    dateFormat: true,
    weldDateNotFuture: true,
    lnkResultControlDateRequired: true,
    lnkResultControlDateFormat: true,
    lnkResultDateAfterWeldDate: true,
    lnkResultRequestDateOrder: true,
    lnkResultVikDateBeforeOther: true,
    lnkResultVikRequiredBeforeOther: true,
    lnkResultConclusionRequired: true,
    lnkResultRepairRules: true,
    pstoResultDateRequired: true,
    pstoResultDateFormat: true,
    pstoResultDateAfterWeldDate: true,
    pstoResultRequestDateOrder: true,
    pstoResultDiagramRequired: true,
    manualJointName: true,
    controlHistoryProtection: true,
    systemJointRenameProtection: true,
  }
}
