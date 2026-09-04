import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  findOfficialWeldRowStampField,
  getOfficialWeldRowStamps,
} from '@/lib/weld-row-stamps'

describe('weld row stamps', () => {
  it('finds the exact official stamp field without case sensitivity', () => {
    const row = weldRow({ stamp1K: 'K-1', stamp2Z: 'Welder-77' })

    expect(findOfficialWeldRowStampField(row, ' welder-77 ')).toBe('stamp2Z')
  })

  it('keeps distinct official stamps and does not duplicate different casing', () => {
    const row = weldRow({ stamp1K: 'K-1', stamp1Z: 'k-1', stamp2K: 'K-2' })

    expect(getOfficialWeldRowStamps(row)).toEqual(['K-1', 'K-2'])
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
