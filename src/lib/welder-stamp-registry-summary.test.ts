import { describe, expect, it } from 'vitest'
import { createEmptyWelderStampDraft } from './welder-stamp-registry'
import { buildWelderStampRegistrySummary, matchesWelderStampRegistryStatus } from './welder-stamp-registry-summary'

function createRecord(id: number, validTo: string) {
  const record = createEmptyWelderStampDraft()
  return {
    ...record,
    id,
    naksStamp: `K${id}`,
    welderName: `Сварщик ${id}`,
    naksPermits: [{
      ...record.naksPermits[0],
      id: `permit-${id}`,
      weldType: 'РД',
      materialGroups: 'M01',
      diameterFrom: '1',
      thicknessFrom: '1',
      validFrom: '2026-01-01',
      validTo,
    }],
  }
}

describe('welder stamp registry summary', () => {
  it('separates active, expiring, expired, archived, suspended and incomplete records', () => {
    const active = createRecord(1, '2026-12-31')
    const soon = createRecord(2, '2026-08-30')
    const expired = createRecord(3, '2026-07-31')
    const archived = { ...createRecord(4, '2026-12-31'), archived: true, archivedAt: '2026-08-01' }
    const suspended = createRecord(5, '2026-12-31')
    const incomplete = { ...createRecord(6, '2026-12-31'), naksPermits: [] }
    const suspensions = [{ id: 1, naksStamp: 'K5', suspendedFrom: '2026-08-01', suspendedTo: '2026-08-31' }]

    expect(buildWelderStampRegistrySummary(
      [active, soon, expired, archived, suspended, incomplete],
      { suspensions, today: '2026-08-24' },
    )).toEqual({ all: 6, active: 1, soon: 1, expired: 1, archived: 1, suspended: 1, incomplete: 1 })
  })

  it('does not include suspended or invalid records in the active filter', () => {
    const record = createRecord(1, '2026-12-31')
    const suspensions = [{ id: 1, naksStamp: 'K1', suspendedFrom: '2026-08-01', suspendedTo: '2026-08-31' }]

    expect(matchesWelderStampRegistryStatus(record, 'active', { suspensions, today: '2026-08-24' })).toBe(false)
    expect(matchesWelderStampRegistryStatus(record, 'suspended', { suspensions, today: '2026-08-24' })).toBe(true)
  })
})
