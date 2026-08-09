import { describe, expect, it } from 'vitest'

import { pinInitiallySelectedRows } from '@/lib/report-row-utils'

const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]

describe('pinInitiallySelectedRows', () => {
  it('places rows selected before opening the dialog first and preserves both groups order', () => {
    const result = pinInitiallySelectedRows(rows, new Set([2, 4]), new Set([2, 4]))

    expect(result.map((row) => row.id)).toEqual([2, 4, 1, 3])
  })

  it('does not move rows selected later inside the dialog', () => {
    const result = pinInitiallySelectedRows(rows, new Set([2, 3]), new Set([2]))

    expect(result.map((row) => row.id)).toEqual([2, 1, 3, 4])
  })

  it('returns an initially selected row to the general list after it is unchecked', () => {
    const result = pinInitiallySelectedRows(rows, new Set([4]), new Set([2, 4]))

    expect(result.map((row) => row.id)).toEqual([4, 1, 2, 3])
  })
})
