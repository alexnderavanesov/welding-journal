import { describe, expect, it } from 'vitest'
import { getProgramDemandAccounting } from './line-program-accounting'

describe('visible line demand arithmetic', () => {
  it('keeps active assignments, mixed methods and historical coverage disjoint', () => {
    expect(getProgramDemandAccounting({
      assignedRowIds: [1, 1, 2, 5], additionalRowIds: [2, 3, 3], coveredRowIds: [1, 2, 3, 4, 4],
    })).toEqual({
      assignments: { yesOnly: 2, additionalOnly: 1, mixed: 1, other: 0, total: 4 },
      coverage: { yesOnly: 1, additionalOnly: 1, mixed: 1, other: 1, total: 4 },
    })
  })
  it('accounts for 200,000 joints with overlapping methods once per set', () => {
    const ids = Array.from({ length: 200_000 }, (_, index) => index + 1)
    const counts = getProgramDemandAccounting({
      assignedRowIds: ids.slice(0, 150_000), additionalRowIds: ids.slice(100_000), coveredRowIds: ids,
    })
    expect(counts.assignments).toMatchObject({ yesOnly: 100_000, additionalOnly: 50_000, mixed: 50_000, total: 200_000 })
    expect(counts.coverage).toMatchObject(counts.assignments)
  })
})
