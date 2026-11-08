import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  findOfficialWeldRowStampField,
  getOfficialWeldRowStamps,
} from '@/lib/weld-row-stamps'

describe('weld row stamps', () => {
  it('keeps both distinct official stamps', () => {
    expect(getOfficialWeldRowStamps(weldRow({ stamp1K: 'A', stamp1Z: 'B' }))).toEqual(['A', 'B'])
  })
  it('finds the exact official stamp field without case sensitivity', () => {
    const row = weldRow({ stamp1K: 'K-1', stamp1Z: 'WELDER-77' })

    expect(findOfficialWeldRowStampField(row, ' welder-77 ')).toBe('stamp1Z')
  })

  it('deduplicates different casing of the same official stamp', () => {
    const row = weldRow({ stamp1K: 'K-1', stamp1Z: 'k-1', })

    expect(getOfficialWeldRowStamps(row)).toEqual(['K-1'])
  })
})

function weldRow(overrides: Partial<WeldRow>): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'L-1',
    joint: 'S1',
    ...overrides,
  }
}
