import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildWorkflowWrite,
  normalizePstoCycleStageCorrectionPayload,
  normalizePstoTvmtAndRemoveLaterCyclesPayload,
  normalizePstoCycleWorkflowPayload,
  saveRepeatCycleWrites,
} from '@/server/psto-repeat-workflow'
import { deletePstoRepeatCyclesInTransaction } from '@/server/psto-cycle-state'

describe('PSTO cycle workflow payload', () => {
  it('keeps welds from different cycles in one document group', () => {
    expect(normalizePstoCycleWorkflowPayload({
      action: 'pstoRequest',
      date: '2026-08-29',
      expectedVersions: [
        { id: 11, version: '101' },
        { id: 22, version: '102' },
      ],
      groups: [{ rowIds: [11, 22], name: 'Заявка ПСТО-021' }],
    })).toEqual({
      action: 'pstoRequest',
      date: '2026-08-29',
      groups: [{ rowIds: [11, 22], name: 'Заявка ПСТО-021', useSystemName: false }],
      results: [],
      expectedVersions: [
        { id: 11, version: '101' },
        { id: 22, version: '102' },
      ],
    })
  })

  it('does not accept duplicate TVMT results as coverage for another selected weld', () => {
    expect(() => normalizePstoCycleWorkflowPayload({
      action: 'tvmtResult',
      date: '2026-08-29',
      expectedVersions: [
        { id: 11, version: '101' },
        { id: 22, version: '102' },
      ],
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

  it('creates a production-sized repeat-cycle selection in bounded batches', async () => {
    const batchSizes: number[] = []
    const tx = {
      insert: () => ({
        values: (records: Array<{ weldJointId: number; sequence: number }>) => ({
          returning: async () => {
            batchSizes.push(records.length)
            return records.map((record) => ({ ...record, id: record.weldJointId }))
          },
        }),
      }),
    }
    const writes = Array.from({ length: 201 }, (_, index) => ({
      weldJointId: index + 1,
      sequence: 2,
    }))

    const saved = await saveRepeatCycleWrites(tx as never, 'pstoRequest', writes)

    expect(batchSizes).toEqual([100, 100, 1])
    expect(saved.map((cycle) => cycle.weldJointId)).toEqual(writes.map((write) => write.weldJointId))
  })

  it('locks a production-sized repeat-cycle update in one globally ordered query', async () => {
    const lockedRows = Array.from({ length: 2_001 }, (_, index) => ({ id: index + 1 }))
    let lockQueryCount = 0
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              for: async () => {
                lockQueryCount += 1
                return lockedRows
              },
            }),
          }),
        }),
      }),
      insert: () => ({
        values: (records: Array<{ id: number }>) => ({
          onConflictDoUpdate: () => ({ returning: async () => records }),
        }),
      }),
    }
    const writes = Array.from({ length: 2_001 }, (_, index) => ({
      id: index + 1,
      weldJointId: index + 1,
      sequence: 2,
    }))

    const saved = await saveRepeatCycleWrites(tx as never, 'pstoResult', writes)

    expect(lockQueryCount).toBe(1)
    expect(saved).toHaveLength(2_001)
    expect(saved.at(-1)?.id).toBe(2_001)
  })

  it('deletes production-sized repeat-cycle selections with one array-bound query', async () => {
    const batchSizes: number[] = []
    const tx = {
      delete: () => ({
        where: async (condition: { queryChunks?: unknown[] }) => {
          batchSizes.push(condition.queryChunks?.length ?? 0)
        },
      }),
    }

    await deletePstoRepeatCyclesInTransaction(
      tx as never,
      Array.from({ length: 2_001 }, (_, index) => index + 1),
    )

    expect(batchSizes).toHaveLength(1)
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
      expectedVersion: ' 101 ',
      sequence: 2.7,
      cycleId: 41.9,
      stage: 'tvmtResult',
      action: 'update',
      date: ' 2026-08-21 ',
      name: ' Заключение ТВМТ-2 ',
      result: ' не годен ',
    })).toEqual({
      rowId: 12,
      expectedVersion: '101',
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
      expectedVersion: '101',
      sequence: 1,
      stage: 'pstoRequest',
      action: 'delete',
    })).toThrow('Не указан стык')
    expect(() => normalizePstoCycleStageCorrectionPayload({
      rowId: 1,
      expectedVersion: '101',
      sequence: 0,
      stage: 'pstoRequest',
      action: 'delete',
    })).toThrow('Не указан цикл')
    expect(() => normalizePstoCycleStageCorrectionPayload({
      rowId: 1,
      expectedVersion: '101',
      sequence: 2,
      stage: 'pstoRequest',
      action: 'delete',
    })).toThrow('Не указан идентификатор повторного цикла')
    expect(() => normalizePstoCycleStageCorrectionPayload({
      rowId: 1,
      expectedVersion: '101',
      sequence: 1,
      stage: 'other' as 'pstoRequest',
      action: 'delete',
    })).toThrow('Неизвестный этап')
    expect(() => normalizePstoCycleStageCorrectionPayload({
      rowId: 1,
      expectedVersion: '101',
      sequence: 1,
      stage: 'pstoRequest',
      action: 'replace' as 'update',
    })).toThrow('Неизвестное изменение')
  })

  it('normalizes an atomic TVMT correction without accepting a client-supplied stage or action', () => {
    expect(normalizePstoTvmtAndRemoveLaterCyclesPayload({
      rowId: 12.8,
      expectedVersion: ' 101 ',
      sequence: 1.9,
      date: ' 2026-08-21 ',
      name: ' Заключение ТВМТ-1 ',
      result: ' годен ',
    })).toEqual({
      rowId: 12,
      expectedVersion: '101',
      sequence: 1,
      cycleId: undefined,
      date: '2026-08-21',
      name: 'Заключение ТВМТ-1',
      result: 'годен',
    })
  })
})
