import { describe, expect, it, vi } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getPrimaryPstoCyclePersistenceValues,
  getPstoCycleState,
  persistPstoCycleWorkflowWrites,
} from '@/server/psto-cycle-state'

describe('PSTO cycle server state', () => {
  it('exposes primary and repeat storage as one ordered timeline', () => {
    const row = {
      id: 7,
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-1',
      pstoRequestDate: '2026-08-20',
      pstoRepeatCycles: [
        { id: 72, weldJointId: 7, sequence: 3, pstoRequest: 'Заявка ПСТО-3' },
        { id: 71, weldJointId: 7, sequence: 2, pstoRequest: 'Заявка ПСТО-2' },
      ],
    } as unknown as WeldRow

    expect(getPstoCycleState(row).map((cycle) => ({
      source: cycle.source,
      sequence: cycle.sequence,
      request: cycle.pstoRequest,
    }))).toEqual([
      { source: 'primary', sequence: 1, request: 'Заявка ПСТО-1' },
      { source: 'repeat', sequence: 2, request: 'Заявка ПСТО-2' },
      { source: 'repeat', sequence: 3, request: 'Заявка ПСТО-3' },
    ])
  })

  it('uses one complete projection for every primary-cycle write', () => {
    const row = {
      pstoRequest: '  Заявка ПСТО-1 ',
      pstoRequestDate: '2026-08-20',
      pstoDate: '',
      heatTreatmentDiagram: null,
      pstoResult: 'ожидает НК',
      tvmtRequest: undefined,
      tvmtResult: '',
    } as unknown as WeldRow

    expect(getPrimaryPstoCyclePersistenceValues(row)).toMatchObject({
      pstoRequest: 'Заявка ПСТО-1',
      pstoRequestDate: '2026-08-20',
      pstoDate: null,
      heatTreatmentDiagram: null,
      pstoResult: 'ожидает НК',
      tvmtRequest: null,
      tvmtResult: null,
    })
  })

  it('persists primary and repeat changes through one transaction boundary', async () => {
    const primary = {
      id: 1,
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-1',
      pstoRequestDate: '2026-08-20',
      pstoResult: 'ожидает НК',
      finalStatus: 'ожидает НК',
      pstoRepeatCycles: [],
    } as unknown as WeldRow
    const repeatOwner = {
      id: 2,
      pstoRequired: 'да',
      finalStatus: 'ожидает НК',
      pstoRepeatCycles: [],
    } as unknown as WeldRow
    const updateReturning = vi
      .fn()
      .mockResolvedValueOnce([{ ...primary }])
      .mockResolvedValueOnce([{ ...repeatOwner }])
    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{
            id: 21,
            weldJointId: 2,
            sequence: 2,
            pstoRequest: 'Заявка ПСТО-2',
            pstoRequestDate: '2026-08-21',
          }]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: updateReturning })),
        })),
      })),
    }

    const saved = await persistPstoCycleWorkflowWrites({
      tx: tx as never,
      action: 'pstoRequest',
      sourceRows: [primary, repeatOwner],
      writes: [
        { source: 'primary', row: primary },
        {
          source: 'repeat',
          cycle: {
            weldJointId: 2,
            sequence: 2,
            pstoRequest: 'Заявка ПСТО-2',
            pstoRequestDate: '2026-08-21',
          },
        },
      ],
    })

    expect(saved.map((row) => row.id)).toEqual([1, 2])
    expect(tx.insert).toHaveBeenCalledTimes(1)
    expect(tx.update).toHaveBeenCalledTimes(2)
  })
})
