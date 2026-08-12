import { describe, expect, it } from 'vitest'

import { formatDateTime, formatDateTimeWithSeconds } from '@/lib/weld-table-formatting'

describe('weld table timestamp formatting', () => {
  it('formats timestamps in Moscow time and hides seconds in table cells', () => {
    const timestamp = '2026-08-12T12:22:36.000Z'

    expect(formatDateTime(timestamp)).toBe('12.08.26 15:22')
    expect(formatDateTimeWithSeconds(timestamp)).toBe('12.08.26 15:22:36')
  })

  it('keeps empty and invalid values predictable', () => {
    expect(formatDateTime(null)).toBe('')
    expect(formatDateTimeWithSeconds('not-a-date')).toBe('not-a-date')
  })
})
