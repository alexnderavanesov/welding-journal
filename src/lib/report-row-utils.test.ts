import { describe, expect, it } from 'vitest'

import { buildHeatTreatmentReportRows, buildLnkReportRows, pinInitiallySelectedRows } from '@/lib/report-row-utils'
import type { WeldRow } from '@/lib/dispatcher-types'

const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]

describe('current report output order', () => {
  const source = [
    { id: 2, joint: 'S2', weldDate: '2026-10-01', hasVik: 'Да', pstoRequired: 'Да', lnkCreatedAt: '2026-10-01', pstoCreatedAt: '2026-10-01' },
    { id: 1, joint: 'S1', weldDate: '2026-10-01', hasVik: 'Да', pstoRequired: 'Да', lnkCreatedAt: '2026-10-02', pstoCreatedAt: '2026-10-02' },
  ] as WeldRow[]

  it('keeps server-sorted LNK current output ahead of default and preserved modal order', () => {
    const result = buildLnkReportRows(source, [1, 2], { preserveSourceOrder: true })
    expect(result.map(row => row.id)).toEqual([2, 1])
    expect(source.map(row => row.id)).toEqual([2, 1])
  })

  it('keeps server-sorted PSTO current output ahead of its default creation-time order', () => {
    const result = buildHeatTreatmentReportRows(source, { preserveSourceOrder: true })
    expect(result.map(row => row.id)).toEqual([2, 1])
    expect(source.map(row => row.id)).toEqual([2, 1])
  })

  it('retains default and preserved order for non-current reports', () => {
    expect(buildLnkReportRows(source).map(row => row.id)).toEqual([1, 2])
    expect(buildLnkReportRows(source, [2, 1]).map(row => row.id)).toEqual([2, 1])
    expect(buildHeatTreatmentReportRows(source).map(row => row.id)).toEqual([1, 2])
  })
})

describe('pinInitiallySelectedRows', () => {
  it('preserves the source array when there are no rows to pin', () => {
    expect(pinInitiallySelectedRows(rows, new Set(), new Set())).toBe(rows)
  })

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
