import { describe, expect, it } from 'vitest'
import { isActiveOfficialWeld } from './control-assignment-eligibility'

type StatusRow = { officiality?: unknown; revisionActuality?: unknown }

// Independent snapshot of the algorithm before the exact-value fast paths.
function oldIsActiveOfficialWeld(row: StatusRow) {
  return String(row.officiality ?? '').trim().toLocaleLowerCase('ru') !== 'неофициальный' &&
    String(row.revisionActuality ?? '').trim().toLocaleLowerCase('ru') !== 'не актуален'
}

const current = (row: StatusRow) => isActiveOfficialWeld(row as Parameters<typeof isActiveOfficialWeld>[0])

describe('officiality fast paths preserve the old exclusion predicate', () => {
  it('matches the old algorithm for canonical, Unicode, legacy and non-string values', () => {
    const values: unknown[] = [undefined, null, '', 'действующий', 'актуальная',
      'неофициальный', 'не актуален', 'официальный', 'актуален',
      'НЕОФИЦИАЛЬНЫЙ', 'НЕ АКТУАЛЕН', '\u00a0НЕОФИЦИАЛЬНЫЙ\ufeff',
      '\u202fНе Актуален\t', 'не\u00a0актуален', 'не  актуален',
      'неофициальныи\u0306', 'неофициальны\u200bй', '\ufeff',
      'İIıi', 'Σσς', 'Ёё', 0, false, true, { toString: () => ' НЕ АКТУАЛЕН ' }]
    for (const officiality of values) for (const revisionActuality of values) {
      const row = { officiality, revisionActuality }
      expect(current(row)).toBe(oldIsActiveOfficialWeld(row))
    }
    // Only outer whitespace is trimmed; this is not a general text normalizer.
    expect(current({ revisionActuality: 'не\u00a0актуален' })).toBe(true)
    expect(current({ revisionActuality: '\u00a0НЕ АКТУАЛЕН\ufeff' })).toBe(false)
  })

  it('reads changes to the same row and coercible value on every call', () => {
    let text = 'действующий'
    const value = { toString: () => text }
    const row: StatusRow = { officiality: value, revisionActuality: 'актуальная' }
    for (const next of ['действующий', 'НЕОФИЦИАЛЬНЫЙ', '', 'неофициальный', 'действующий']) {
      text = next
      expect(current(row)).toBe(oldIsActiveOfficialWeld(row))
    }
    for (const next of ['не актуален', 'актуальная', '\u00a0НЕ АКТУАЛЕН\ufeff', null]) {
      row.revisionActuality = next
      expect(current(row)).toBe(oldIsActiveOfficialWeld(row))
    }
    row.officiality = 'неофициальный'
    expect(current(row)).toBe(false)
    row.officiality = 'действующий'
    expect(current(row)).toBe(true)
  })

  it('keeps the original short circuit when officiality excludes the row', () => {
    for (const officiality of ['неофициальный', '\u00a0НЕОФИЦИАЛЬНЫЙ\ufeff']) {
      const row = { officiality, get revisionActuality(): string { throw new Error('must not read actuality') } }
      expect(oldIsActiveOfficialWeld(row)).toBe(false)
      expect(current(row)).toBe(false)
    }
  })
})
