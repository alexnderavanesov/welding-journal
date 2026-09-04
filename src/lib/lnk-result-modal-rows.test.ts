import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { filterLnkResultRows } from '@/lib/lnk-result-modal-rows'

describe('filterLnkResultRows', () => {
  it('keeps result rows in workflow priority order', () => {
    const rows = [
      createRow(1, 'L-4', { vikResult: 'годен' }),
      createRow(2, 'L-3', { vikResult: 'ремонт', finalStatus: 'не годен' }),
      createRow(3, 'L-2', { vikResult: 'годен', finalStatus: 'годен' }),
      createRow(4, 'L-1', { vikRequest: 'Заявка-1' }),
    ]

    expect(filterLnkResultRows(rows, '', 'vikRequest').map((row) => row.id)).toEqual([4, 3, 2, 1])
  })

  it('filters nonmatching rows before calculating their result priority', () => {
    const nonmatchingRow = createRow(1, 'OTHER')
    Object.defineProperty(nonmatchingRow, 'vikResult', {
      get: () => {
        throw new Error('priority should not be calculated for a filtered row')
      },
    })
    const matchingRow = createRow(2, 'TARGET', { vikRequest: 'Заявка-2' })

    expect(filterLnkResultRows([nonmatchingRow, matchingRow], 'target', 'vikRequest')).toEqual([matchingRow])
  })
})

function createRow(id: number, line: string, overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    line,
    joint: `F${id}`,
    finalStatus: '',
    vikRequest: '',
    vikResult: '',
    ...overrides,
  } as WeldRow
}
