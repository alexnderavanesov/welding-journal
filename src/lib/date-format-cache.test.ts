import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

async function freshParser() {
  vi.resetModules()
  return import('./date-format')
}

// Independent frozen oracle for the pre-optimization parser: calendar validity,
// accepted text formats and Date-object local-calendar behavior are unchanged.
function originalParse(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null :
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const text = String(value ?? '').trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const display = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(text)
  if (!iso && !display) return null
  const [year, month, day] = iso ? [+iso[1], +iso[2], +iso[3]] :
    [display![3].length === 2 ? 2000 + +display![3] : +display![3], +display![2], +display![1]]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day ? null :
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

describe('bounded deterministic date parsing reuse', () => {
  it('validates a repeated calendar value once, without skipping invalid-date checks', async () => {
    const { parseDateLikeToIso } = await freshParser()
    const utc = vi.spyOn(Date, 'UTC')
    for (let i = 0; i < 1000; i++) {
      expect(parseDateLikeToIso('2028-02-29')).toBe('2028-02-29')
      expect(parseDateLikeToIso('2027-02-29')).toBeNull()
    }
    expect(utc).toHaveBeenCalledTimes(2)
  })

  it('matches the old parser for calendar boundaries, formats, blanks and malformed inputs', async () => {
    const { parseDateLikeToIso } = await freshParser()
    for (const year of [0, 1, 99, 100, 400, 1900, 2000, 2024, 2026, 2100, 2400, 9999]) {
      for (let month = 0; month <= 13; month++) for (let day = 0; day <= 32; day++) {
        const values = [`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          `${day}.${month}.${String(year).padStart(4, '0')}`]
        for (const value of values) expect(parseDateLikeToIso(value), value).toBe(originalParse(value))
      }
    }
    for (const value of [undefined, null, '', ' ', '-', 20261014, '1.2.24', ' 29.2.00 ', '1/2/2026',
      '2026-01-01T00:00:00Z', '2026-1-1', 'text'.repeat(1000), new Date(NaN), new Date(2026, 1, 28)]) {
      expect(parseDateLikeToIso(value)).toBe(originalParse(value))
    }
  })

  it('does not retain mutable Date objects or cache today-dependent validation', async () => {
    const { parseDateLikeToIso, getDateInputValidationReason } = await freshParser()
    const date = new Date(2026, 9, 14)
    expect(parseDateLikeToIso(date)).toBe('2026-10-14')
    date.setDate(15)
    expect(parseDateLikeToIso(date)).toBe('2026-10-15')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T20:59:59Z'))
    expect(getDateInputValidationReason('2026-10-14', 'Дата', { disallowFuture: true })).toContain('позже сегодняшней')
    vi.setSystemTime(new Date('2026-10-13T21:00:00Z'))
    expect(getDateInputValidationReason('2026-10-14', 'Дата', { disallowFuture: true })).toBe('')
  })

  it('evicts old entries after 256 distinct short values without dropping validation', async () => {
    const { parseDateLikeToIso } = await freshParser()
    const utc = vi.spyOn(Date, 'UTC')
    for (let i = 0; i < 257; i++) parseDateLikeToIso(`${3000 + i}-01-01`)
    parseDateLikeToIso('3256-01-01')
    expect(utc).toHaveBeenCalledTimes(257)
    parseDateLikeToIso('3000-01-01')
    expect(utc).toHaveBeenCalledTimes(258)
  })
})
