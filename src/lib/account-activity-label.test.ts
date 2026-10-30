import { describe, expect, it } from 'vitest'
import { formatAccountActivityTime } from './account-activity-label'

describe('last activity labels', () => {
  const date = '2026-10-30T07:15:00.000Z'
  const start = new Date(date).getTime()
  it.each([
    [0, 'только что'], [59, 'только что'], [60, '1 минуту назад'], [180, '3 минуты назад'],
    [21 * 60, '21 минуту назад'], [3600, '1 час назад'], [3 * 3600, '3 часа назад'],
    [86400, '1 день назад'], [3 * 86400, '3 дня назад'],
  ])('formats %s seconds with Russian inflection', (seconds, label) => {
    expect(formatAccountActivityTime(date, start + seconds * 1000)).toEqual({ label, exact: '30.10.2026, 10:15 МСК', iso: date })
  })
  it('shows an exact Moscow timestamp after a week and preserves it in every relative label', () => {
    const result = formatAccountActivityTime(date, start + 7 * 86400_000)!
    expect(result.label).toBe('30.10.2026, 10:15 МСК')
    expect(result.exact).toBe(result.label)
  })
  it('handles clock skew and invalid dates without showing future activity', () => {
    expect(formatAccountActivityTime(date, start - 60_000)?.label).toBe('только что')
    expect(formatAccountActivityTime('not a date', start)).toBeNull()
  })
})
