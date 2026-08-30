import { describe, expect, it, vi } from 'vitest'

import {
  preHeatTreatmentControls,
  pstoRepeatCycles,
} from '@/db/schema'
import {
  getFinalStatusPersistenceChanges,
  prepareDispatcherReportRows,
} from '@/server/dispatcher-task-index'

describe('prepareDispatcherReportRows', () => {
  it('persists only genuinely changed calculated final statuses', () => {
    expect(getFinalStatusPersistenceChanges(
      [
        { id: 1, finalStatus: 'ожидает заявку' },
        { id: 2, finalStatus: 'годен' },
        { id: 3, finalStatus: null },
      ],
      [
        { id: 1, finalStatus: 'годен' },
        { id: 2, finalStatus: 'годен' },
        { id: 3, finalStatus: 'ожидает НК' },
      ],
    )).toEqual([
      { id: 1, previousFinalStatus: 'ожидает заявку', finalStatus: 'годен' },
      { id: 3, previousFinalStatus: null, finalStatus: 'ожидает НК' },
    ])
  })

  it('loads pre-TO and repeat-cycle relations before building persisted dispatcher rows', async () => {
    const preControl = {
      id: 31,
      weldJointId: 7,
      method: 'ВИК',
      result: 'ожидает НК',
    }
    const repeatCycle = {
      id: 41,
      weldJointId: 7,
      sequence: 2,
      pstoResult: 'годен',
      tvmtResult: 'ожидает НК',
    }
    const select = vi.fn(() => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: async () => table === preHeatTreatmentControls
            ? [preControl]
            : table === pstoRepeatCycles
              ? [repeatCycle]
              : [],
        }),
      }),
    }))
    const tx = { select } as unknown as Parameters<typeof prepareDispatcherReportRows>[0]
    const rows = [{ id: 7, joint: 'F7', pstoRequired: 'да' }] as unknown as Parameters<
      typeof prepareDispatcherReportRows
    >[1]
    const duplicates = [{
      id: 51,
      weldJointId: 7,
      method: 'РК',
      result: 'годен',
      controlDate: '2026-08-28',
      conclusion: 'Дубль РК',
      conclusionDate: '2026-08-28',
    }] as Parameters<typeof prepareDispatcherReportRows>[2]

    const preparedRows = await prepareDispatcherReportRows(tx, rows, duplicates)

    expect(select).toHaveBeenCalledTimes(2)
    expect(preparedRows[0]?.preHeatTreatmentControls).toEqual([preControl])
    expect(preparedRows[0]?.pstoRepeatCycles).toEqual([repeatCycle])
    expect(preparedRows[0]?.duplicateControls).toHaveLength(1)
    expect(preparedRows[0]?.duplicateControls?.[0]?.conclusion).toBe('Дубль РК')
  })
})
