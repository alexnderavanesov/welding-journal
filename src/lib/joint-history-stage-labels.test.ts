import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildPstoCycleTimeline } from '@/lib/psto-cycle'
import {
  getJointPreHeatTreatmentLabel,
  getJointPstoCycleLabel,
  getJointPstoStartLabel,
  hasJointPstoCycleHistory,
} from './joint-history-stage-labels'

const base = { preHeatTreatmentRequired: true, id: 1, joint: 'F1', pstoRequired: 'да', hasVik: 'да', weldDate: '2026-09-01' } as WeldRow
const pending = { id: 1, weldJointId: 1, method: 'ВИК', requestName: 'ВИК-1', requestDate: '2026-09-02' }

describe('joint picture section captions', () => {
  it.each([
    ['no assignment', { preHeatTreatmentRequired: true, pstoRequired: null }, 'ПСТО не предусмотрено', 'ПСТО не предусмотрено'],
    ['cancelled', { preHeatTreatmentRequired: true, pstoRequired: 'отменен' }, 'ПСТО отменено', 'ПСТО отменено'],
    ['not welded', { weldDate: null }, 'Ожидает сварку', 'Ожидает сварку'],
    ['no request', {}, 'Ожидает заявку НК до ТО', 'Ожидает НК до ТО'],
    ['pending result', { preHeatTreatmentControls: [pending] }, 'Ожидает результаты НК до ТО', 'Ожидает завершения НК до ТО'],
    ['good result', { preHeatTreatmentControls: [{ ...pending, result: 'годен' }] }, null, 'Ожидает заявку ПСТО'],
    ['rejected', { preHeatTreatmentControls: [{ ...pending, result: 'ремонт' }] }, null, 'ПСТО не требуется: НК до ТО имеет негодный результат'],
    ['disabled', { preHeatTreatmentRequired: false }, 'НК до ТО для цепочки не требуется', 'Ожидает заявку ПСТО'],
    ['disabled rejection', { preHeatTreatmentRequired: false, preHeatTreatmentControls: [{ ...pending, result: 'вырез' }] }, 'НК до ТО для цепочки не требуется', 'ПСТО не требуется: НК до ТО имеет негодный результат'],
    ['no methods', { hasVik: null }, 'Методы НК до ТО не назначены', 'Ожидает заявку ПСТО'],
    ['partial methods', { hasRk: 'да', preHeatTreatmentControls: [{ ...pending, result: 'годен' }] }, 'Ожидает заявку НК до ТО', 'Ожидает НК до ТО'],
    ['missing weld with history', { weldDate: null, preHeatTreatmentControls: [pending] }, 'Дата сварки не указана', 'Ожидает сварку'],
  ] as const)('%s', (_case, changes, pre, psto) => {
    const row = { ...base, ...changes } as WeldRow
    const before = structuredClone(row)
    expect(getJointPreHeatTreatmentLabel(row)).toBe(pre)
    expect(getJointPstoStartLabel(row)).toBe(psto)
    expect(row).toEqual(before)
  })

  it.each([
    [{ pstoRequest: 'ПСТО-1' }, 'Ожидает ПСТО'],
    [{ pstoRequest: 'ПСТО-1', pstoResult: 'ожидает ПСТО' }, 'Ожидает ПСТО'],
    [{ pstoRequest: 'ПСТО-1', pstoResult: 'проведено' }, 'ПСТО: проведено · Ожидает заявку ТВМТ'],
    [{ pstoRequest: 'ПСТО-1', pstoResult: 'проведено', tvmtRequest: 'ТВМТ-1', tvmtResult: 'ожидает ТВМТ' }, 'ПСТО: проведено · Ожидает результат ТВМТ'],
    [{ pstoRequest: 'ПСТО-1', tvmtResult: 'годен' }, 'ТВМТ: годен'],
    [{ pstoRequest: 'ПСТО-1', tvmtResult: 'не годен' }, 'ТВМТ: не годен'],
    [{ preHeatTreatmentRequired: true, pstoRequired: null, pstoRequest: 'ПСТО-1' }, 'Сохранённая заявка; выполнение ПСТО не требуется'],
    [{ preHeatTreatmentRequired: true, pstoRequired: 'отменен', pstoRequest: 'ПСТО-1', pstoResult: 'проведено', tvmtRequest: 'ТВМТ-1' }, 'ПСТО: проведено · Ожидает результат ТВМТ'],
    [{ pstoDate: '2026-09-05' }, 'Данные цикла неполные'],
    [{ pstoResult: 'старое значение' }, 'ПСТО: старое значение'],
    [{ pstoResult: 'проведено', tvmtResult: 'старый результат' }, 'ТВМТ: старый результат'],
    [{ preHeatTreatmentRequired: true, pstoRequired: null, pstoRequest: 'ПСТО-1', pstoResult: 'старое значение' }, 'ПСТО: старое значение'],
    [{ preHeatTreatmentRequired: true, pstoRequired: 'отменен', pstoRequest: 'ПСТО-1', tvmtResult: 'старый результат' }, 'ТВМТ: старый результат'],
  ])('preserves facts and distinguishes each cycle step: %j', (changes, expected) => {
    const row = { ...base, ...changes }
    const cycle = buildPstoCycleTimeline(row)[0]!
    expect(getJointPstoCycleLabel(row, cycle)).toBe(expected)
    expect(hasJointPstoCycleHistory(cycle)).toBe(true)
  })

  it('retains the exact result of each repeat instead of substituting the current cycle', () => {
    const row = { ...base, pstoRequest: 'ПСТО-1', pstoResult: 'проведено', tvmtRequest: 'ТВМТ-1', tvmtResult: 'не годен',
      pstoRepeatCycles: [{ id: 2, weldJointId: 1, sequence: 2, pstoRequest: 'ПСТО-2', pstoResult: 'проведено', tvmtRequest: 'ТВМТ-2', tvmtResult: 'годен' }],
    }
    expect(buildPstoCycleTimeline(row, row.pstoRepeatCycles).map(cycle => getJointPstoCycleLabel(row, cycle)))
      .toEqual(['ТВМТ: не годен', 'ТВМТ: годен'])
  })

  it('does not mistake assignment or generated waiting values for historical facts', () => {
    for (const changes of [{}, { pstoResult: 'ожидает заявку', tvmtResult: 'ожидает заявку' }, { preHeatTreatmentRequired: true, pstoRequired: null, pstoResult: 'ожидает заявку' }]) {
      expect(hasJointPstoCycleHistory(buildPstoCycleTimeline({ ...base, ...changes })[0]!)).toBe(false)
    }
    for (const changes of [{ pstoNote: 'Примечание' }, { pstoRequestDate: '2026-09-05' }, { heatTreatmentDiagram: 'Диаграмма' }]) {
      expect(hasJointPstoCycleHistory(buildPstoCycleTimeline({ ...base, ...changes })[0]!)).toBe(true)
    }
  })
})
