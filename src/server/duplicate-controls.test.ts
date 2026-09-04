import { describe, expect, it } from 'vitest'

import {
  assertDuplicateControlRepairAllowed,
  assertDuplicateControlVersion,
  getDuplicateControlAffectedWeldJointIds,
  normalizeDuplicateControlDate,
  persistDuplicateControlUpdates,
  splitDuplicateControlInsertBatches,
} from '@/server/duplicate-controls'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'

describe('duplicate-control affected weld joints', () => {
  it('keeps both the previous and next weld when a control is reassigned', () => {
    expect(getDuplicateControlAffectedWeldJointIds(51, 52)).toEqual([51, 52])
  })

  it('deduplicates unchanged and invalid weld ids', () => {
    expect(getDuplicateControlAffectedWeldJointIds(51, 51, 0, Number.NaN)).toEqual([51])
  })
})

describe('duplicate-control dates', () => {
  it('normalizes supported dates and rejects malformed or too-early dates', () => {
    expect(normalizeDuplicateControlDate('04.09.2026')).toBe('2026-09-04')
    expect(normalizeDuplicateControlDate('')).toBeNull()
    expect(() => normalizeDuplicateControlDate('31.02.2026')).toThrow('Некорректная дата')
    expect(() => normalizeDuplicateControlDate('2023-12-31')).toThrow(
      'не может быть раньше 01.01.2024',
    )
  })
})

describe('duplicate-control concurrent editing', () => {
  const row = { updatedAt: new Date('2026-09-04T10:00:00.000Z') }

  it('accepts the version that was opened by the user', () => {
    expect(() => assertDuplicateControlVersion(row, '2026-09-04T10:00:00.000Z')).not.toThrow()
  })

  it('rejects a missing or stale version', () => {
    expect(() => assertDuplicateControlVersion(row, '')).toThrow('уже изменен другим пользователем')
    expect(() => assertDuplicateControlVersion(row, '2026-09-04T09:59:59.000Z'))
      .toThrow('уже изменен другим пользователем')
  })
})

describe('duplicate-control batch writes', () => {
  it('keeps query growth bounded for a large set of new controls', () => {
    const records = Array.from({ length: 1_201 }, (_, index) => index + 1)
    const batches = splitDuplicateControlInsertBatches(records)

    expect(batches.map((batch) => batch.length)).toEqual([500, 500, 201])
    expect(batches.flat()).toEqual(records)
  })

  it('updates several existing controls in one insert/upsert query', async () => {
    let insertCalls = 0
    const tx = {
      insert: () => {
        insertCalls += 1
        return {
          values: (values: Array<Record<string, unknown>>) => ({
            onConflictDoUpdate: () => ({ returning: async () => values }),
          }),
        }
      },
    }
    const previous = (id: number) => ({
      id,
      weldJointId: id,
      method: 'РК',
      result: 'годен',
      controlDate: null,
      conclusion: null,
      conclusionDate: null,
      createdAt: new Date('2026-09-04T08:00:00.000Z'),
      updatedAt: new Date(`2026-09-04T09:00:0${id}.000Z`),
    })

    const updated = await persistDuplicateControlUpdates(tx as never, [1, 2].map((id, index) => ({
      index,
      previous: previous(id),
      insertData: {
        weldJointId: id,
        method: 'УЗК',
        result: 'ремонт',
      },
    })))

    expect(insertCalls).toBe(1)
    expect(updated.map(({ updated: row }) => [row.id, row.method, row.result])).toEqual([
      [1, 'УЗК', 'ремонт'],
      [2, 'УЗК', 'ремонт'],
    ])
  })
})

describe('duplicate-control repair rules', () => {
  const smallDiameterRow = {
    joint: 'F1',
    d1: 57,
    d2: 57,
  } as WeldInput

  it('enforces ZV-20 for a duplicate-control repair', () => {
    expect(() => assertDuplicateControlRepairAllowed(
      smallDiameterRow,
      { method: 'ВИК', result: 'ремонт' },
      DEFAULT_SAVE_CHECK_SETTINGS,
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toThrow(/ЗВ-20.*ВИК \(дубль\)/)
  })

  it('allows the same legacy value when ZV-20 is disabled', () => {
    expect(() => assertDuplicateControlRepairAllowed(
      smallDiameterRow,
      { method: 'ВИК', result: 'ремонт' },
      { ...DEFAULT_SAVE_CHECK_SETTINGS, lnkResultRepairRules: false },
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).not.toThrow()
  })
})
