import { describe, expect, it } from 'vitest'
import {
  assertWelderStampSuspensionsReferenceRegistry,
  prepareWelderStampRecordsForPersistence,
  prepareWelderStampSuspensionsForPersistence,
} from '@/lib/welder-stamp-persistence-validation'
import { createEmptyNaksPermit } from '@/lib/welder-stamp-permits'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

describe('prepareWelderStampRecordsForPersistence', () => {
  it('normalizes and accepts a valid card with complementary NAKS permits', () => {
    const records = prepareWelderStampRecordsForPersistence([
      record({
        naksPermits: [
          permit({ id: 'naks-1', diameterFrom: '1', diameterTo: '50', thicknessFrom: '1', thicknessTo: '5' }),
          permit({ id: 'naks-2', diameterFrom: '50', diameterTo: '100', thicknessFrom: '5', thicknessTo: '10' }),
        ],
      }),
    ])

    expect(records[0]).toMatchObject({
      id: 1,
      naksStamp: 'ABC1',
      diameterFrom: '1',
      diameterTo: '100',
      thicknessFrom: '1',
      thicknessTo: '10',
    })
  })

  it('allows archiving the last NAKS permit without deleting its history', () => {
    const records = prepareWelderStampRecordsForPersistence([
      record({ naksPermits: [permit({ id: 'naks-1', archived: true })] }),
    ])

    expect(records[0]?.naksPermits).toHaveLength(1)
    expect(records[0]?.naksPermits[0]?.archived).toBe(true)
  })

  it('rejects malformed DLS ranges even when the request bypasses the UI', () => {
    expect(() =>
      prepareWelderStampRecordsForPersistence([
        record({
          dlsPermits: [
            {
              ...permit({ id: 'dls-1', diameterFrom: '1', diameterTo: '200' }),
              number: 'DLS-1',
            },
          ],
        }),
      ]),
    ).toThrow(/диапазон диаметра ДЛС.*не покрыт/)
  })

  it('rejects duplicate record IDs', () => {
    expect(() => prepareWelderStampRecordsForPersistence([record(), record()])).toThrow(/повторяется системный ID 1/)
  })

  it('rejects missing hidden permit IDs instead of silently replacing them', () => {
    expect(() =>
      prepareWelderStampRecordsForPersistence([
        record({ naksPermits: [permit({ id: '' })] }),
      ]),
    ).toThrow(/отсутствует системный ID допуска/)
  })
})

describe('prepareWelderStampSuspensionsForPersistence', () => {
  it('normalizes and accepts a valid suspension', () => {
    expect(
      prepareWelderStampSuspensionsForPersistence([
        { id: 3, naksStamp: 'abc1', suspendedFrom: '01.02.2026', suspendedTo: '10.02.2026' },
      ]),
    ).toEqual([{ id: 3, naksStamp: 'ABC1', suspendedFrom: '2026-02-01', suspendedTo: '2026-02-10' }])
  })

  it('rejects an invalid suspension period', () => {
    expect(() =>
      prepareWelderStampSuspensionsForPersistence([
        { id: 3, naksStamp: 'ABC1', suspendedFrom: '2026-02-10', suspendedTo: '2026-02-01' },
      ]),
    ).toThrow(/дата «от» позже даты «до»/)
  })

  it('rejects a suspension for a stamp absent from the registry', () => {
    const suspensions = prepareWelderStampSuspensionsForPersistence([
      { id: 3, naksStamp: 'ABC1', suspendedFrom: '2026-02-01', suspendedTo: '' },
    ])

    expect(() => assertWelderStampSuspensionsReferenceRegistry(suspensions, [{ naksStamp: 'XYZ9' }])).toThrow(
      /ABC1 отсутствует в справочнике/,
    )
  })
})

function record(overrides: Partial<WelderStampRecord> = {}): WelderStampRecord {
  return {
    id: 1,
    naksStamp: 'ABC1',
    welderName: 'Петров Иван',
    internalStamp: '',
    weldType: '',
    materialGroups: '',
    diameterFrom: '',
    diameterTo: '',
    thicknessFrom: '',
    thicknessTo: '',
    validFrom: '',
    validTo: '',
    naksPermits: [permit()],
    dlsPermits: [],
    archived: false,
    archivedAt: '',
    ...overrides,
  }
}

function permit(overrides: Partial<ReturnType<typeof createEmptyNaksPermit>> = {}) {
  return {
    ...createEmptyNaksPermit(),
    id: 'naks-1',
    weldType: 'РАД',
    materialGroups: 'М01',
    diameterFrom: '1',
    diameterTo: '100',
    thicknessFrom: '1',
    thicknessTo: '10',
    validFrom: '2026-01-01',
    validTo: '2028-01-01',
    ...overrides,
  }
}
