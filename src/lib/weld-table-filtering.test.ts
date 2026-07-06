import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildPercentageLineStampFilters } from '@/lib/report-navigation'
import { filterWeldRowsByColumns } from '@/lib/weld-table-filtering'

function row(partial: Partial<WeldRow>): WeldRow {
  return {
    id: crypto.randomUUID(),
    projectTitle: 'ТКМ5',
    subtitleCode: '1',
    line: '330-01',
    joint: '',
    ...partial,
  } as WeldRow
}

describe('filterWeldRowsByColumns', () => {
  it('filters percentage line rows by stamp in any official stamp field', () => {
    const rows = [
      row({ joint: 'S1', stamp1K: 'ABC1' }),
      row({ joint: 'S2', stamp1Z: 'ABC1' }),
      row({ joint: 'S3', stamp2O: 'ABC1' }),
      row({ joint: 'S4', stamp1K: 'ARCH' }),
      row({ joint: 'S5', line: '330-02', stamp1K: 'ABC1' }),
      row({ joint: 'S6', stamp1KFact: 'ABC1' }),
    ]

    const filteredRows = filterWeldRowsByColumns(
      rows,
      buildPercentageLineStampFilters({
        projectTitle: 'ТКМ5',
        subtitleCode: '1',
        line: '330-01',
        stamp: 'ABC1',
      }),
    )

    expect(filteredRows.map((candidate) => candidate.joint)).toEqual(['S1', 'S2', 'S3'])
  })
})
