import { describe, expect, it } from 'vitest'

import { getNextTimestampVersion } from '@/server/timestamp-version'

describe('timestamp optimistic-lock versions', () => {
  it('always advances even when the clock candidate is equal or older', () => {
    const current = new Date('2026-09-04T10:00:00.100Z')

    expect(getNextTimestampVersion(current, new Date('2026-09-04T10:00:00.100Z')).toISOString())
      .toBe('2026-09-04T10:00:00.101Z')
    expect(getNextTimestampVersion(current, new Date('2026-09-04T09:59:59.000Z')).toISOString())
      .toBe('2026-09-04T10:00:00.101Z')
  })

  it('uses a later clock candidate unchanged', () => {
    const current = new Date('2026-09-04T10:00:00.100Z')
    const later = new Date('2026-09-04T10:00:01.000Z')

    expect(getNextTimestampVersion(current, later)).toEqual(later)
  })
})
