import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildWorkflowWrite,
  normalizePstoCycleStageCorrectionPayload,
  normalizePstoCycleWorkflowPayload,
  saveRepeatCycleWrites,
} from '@/server/psto-repeat-workflow'

describe('PSTO cycle workflow payload', () => {
  it('keeps welds from different cycles in one document group', () => {
    expect(normalizePstoCycleWorkflowPayload({
      action: 'pstoRequest',
      date: '2026-08-29',
      groups: [{ rowIds: [11, 22], name: 'Заявка ПСТО-021' }],
    })).toEqual({
      action: 'pstoRequest',
      date: '2026-08-29',
      groups: [{ rowIds: [11, 22], name: 'Заявка ПСТО-021', useSystemName: false }],
      results: [],
    })
  })

  it('does not accept duplicate TVMT results as coverage for another selected weld', () => {
    expect(() => normalizePstoCycleWorkflowPayload({
      action: 'tvmtResult',
      date: '2026-08-29',
      groups: [{ rowIds: [11, 22], name: 'Заключение ТВМТ-021' }],
      results: [
        { rowId: 11, result: 'годен' },
        { rowId: 11, result: 'не годен' },
      ],
    })).toThrow('указан несколько раз')
  })

  it('does not issue an empty repeat-cycle insert for a primary-only request', async () => {
    await expect(saveRepeatCycleWrites(
      {} as never,
      'pstoRequest',
      [],
    )).resolves.toEqual([])
  })

  it('starts cycle 2 after a failed TVMT result in the primary cycle', () => {
    const row = {
      id: 12,
      joint: 'F12',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-001',
      pstoRequestDate: '2026-08-20',
      pstoDate: '2026-08-21',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtRequestDate: '2026-08-22',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-23',
      tvmtConclusion: 'Заключение ТВМТ-001',
      pstoRepeatCycles: [],
    } as unknown as WeldRow

    const write = buildWorkflowWrite({
      action: 'pstoRequest',
      row,
      date: '2026-08-24',
      name: 'Заявка ПСТО-002',
      result: '',
    })

    expect(write.source).toBe('repeat')
    if (write.source !== 'repeat') throw new Error('Expected a repeat-cycle write.')
    expect(write.cycle).toMatchObject({
      weldJointId: 12,
      sequence: 2,
      pstoRequest: 'Заявка ПСТО-002',
      pstoRequestDate: '2026-08-24',
    })
  })

  it('finishes a performed cycle after cancellation but does not start another cycle', () => {
    const cancelledFailed = {
      id: 17,
      joint: 'F17',
      pstoRequired: 'отменен',
      pstoRequest: 'Заявка ПСТО-001',
      pstoRequestDate: '2026-08-20',
      pstoDate: '2026-08-21',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtRequestDate: '2026-08-22',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-23',
      tvmtConclusion: 'Заключение ТВМТ-001',
      pstoRepeatCycles: [],
    } as unknown as WeldRow

    expect(() => buildWorkflowWrite({
      action: 'pstoRequest',
      row: cancelledFailed,
      date: '2026-08-24',
      name: 'Заявка ПСТО-002',
      result: '',
    })).toThrow('действие не соответствует текущему циклу')

    const cancelledAwaitingTvmt = {
      ...cancelledFailed,
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
    }
    expect(buildWorkflowWrite({
      action: 'tvmtRequest',
      row: cancelledAwaitingTvmt,
      date: '2026-08-22',
      name: 'Заявка ТВМТ-001',
      result: '',
    }).source).toBe('primary')

    expect(() => buildWorkflowWrite({
      action: 'pstoRequest',
      row: {
        id: 18,
        joint: 'F18',
        pstoRequired: 'отменен',
        pstoRepeatCycles: [],
      } as unknown as WeldRow,
      date: '2026-08-24',
      name: 'Заявка ПСТО-001',
      result: '',
    })).toThrow('действие не соответствует текущему циклу')
  })

  it('does not create another cycle after a cancelled physical cycle is complete', () => {
    const cancelledComplete = {
      id: 19,
      joint: 'F19',
      pstoRequired: 'отменен',
      pstoRequest: 'Заявка ПСТО-001',
      pstoRequestDate: '2026-08-20',
      pstoDate: '2026-08-21',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtRequestDate: '2026-08-22',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-23',
      tvmtConclusion: 'Заключение ТВМТ-001',
      pstoRepeatCycles: [],
    } as unknown as WeldRow

    expect(() => buildWorkflowWrite({
      action: 'pstoRequest',
      row: cancelledComplete,
      date: '2026-08-24',
      name: 'Заявка ПСТО-002',
      result: '',
    })).toThrow('действие не соответствует текущему циклу')
  })

  it('rejects a stale primary request that would overwrite the current cycle', () => {
    const row = {
      id: 13,
      joint: 'F13',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-001',
      pstoRequestDate: '2026-08-20',
      pstoResult: 'ожидает НК',
      pstoRepeatCycles: [],
    } as unknown as WeldRow

    expect(() => buildWorkflowWrite({
      action: 'pstoRequest',
      row,
      date: '2026-08-21',
      name: 'Заявка ПСТО-002',
      result: '',
    })).toThrow('действие не соответствует текущему циклу')
  })

  it('rejects a stale primary result that would overwrite a completed PSTO', () => {
    const row = {
      id: 14,
      joint: 'F14',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-001',
      pstoRequestDate: '2026-08-20',
      pstoDate: '2026-08-21',
      pstoResult: 'проведено',
      heatTreatmentDiagram: 'ПСТО-Д-001',
      pstoRepeatCycles: [],
    } as unknown as WeldRow

    expect(() => buildWorkflowWrite({
      action: 'pstoResult',
      row,
      date: '2026-08-22',
      name: 'ПСТО-Д-002',
      result: '',
    })).toThrow('действие не соответствует текущему циклу')
  })

  it('keeps primary and repeat cycle writes separate inside one document', () => {
    const primary = {
      id: 15,
      joint: 'F15',
      pstoRequired: 'да',
      pstoRepeatCycles: [],
    } as unknown as WeldRow
    const repeat = {
      id: 16,
      joint: 'F16',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-001',
      pstoRequestDate: '2026-08-20',
      pstoDate: '2026-08-21',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtRequestDate: '2026-08-22',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-23',
      tvmtConclusion: 'Заключение ТВМТ-001',
      pstoRepeatCycles: [],
    } as unknown as WeldRow

    const primaryWrite = buildWorkflowWrite({
      action: 'pstoRequest',
      row: primary,
      date: '2026-08-24',
      name: 'Заявка ПСТО-002',
      result: '',
    })
    const repeatWrite = buildWorkflowWrite({
      action: 'pstoRequest',
      row: repeat,
      date: '2026-08-24',
      name: 'Заявка ПСТО-002',
      result: '',
    })

    expect(primaryWrite.source).toBe('primary')
    expect(repeatWrite.source).toBe('repeat')
  })
})

describe('PSTO cycle correction payload', () => {
  it('normalizes the exact row, cycle and stage identity', () => {
    expect(normalizePstoCycleStageCorrectionPayload({
      rowId: 12.8,
      sequence: 2.7,
      cycleId: 41.9,
      stage: 'tvmtResult',
      action: 'update',
      date: ' 2026-08-21 ',
      name: ' Заключение ТВМТ-2 ',
      result: ' не годен ',
    })).toEqual({
      rowId: 12,
      sequence: 2,
      cycleId: 41,
      stage: 'tvmtResult',
      action: 'update',
      date: '2026-08-21',
      name: 'Заключение ТВМТ-2',
      result: 'не годен',
    })
  })

  it('rejects unknown rows, cycles, stages and actions', () => {
    expect(() => normalizePstoCycleStageCorrectionPayload({
      rowId: 0,
      sequence: 1,
      stage: 'pstoRequest',
      action: 'delete',
    })).toThrow('Не указан стык')
    expect(() => normalizePstoCycleStageCorrectionPayload({
      rowId: 1,
      sequence: 0,
      stage: 'pstoRequest',
      action: 'delete',
    })).toThrow('Не указан цикл')
    expect(() => normalizePstoCycleStageCorrectionPayload({
      rowId: 1,
      sequence: 1,
      stage: 'other' as 'pstoRequest',
      action: 'delete',
    })).toThrow('Неизвестный этап')
    expect(() => normalizePstoCycleStageCorrectionPayload({
      rowId: 1,
      sequence: 1,
      stage: 'pstoRequest',
      action: 'replace' as 'update',
    })).toThrow('Неизвестное изменение')
  })
})
