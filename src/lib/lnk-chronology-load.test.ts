import { describe, expect, it, vi } from 'vitest'
import { getLnkChronologyIssues } from './lnk-chronology-checks'

describe('batch chronology diagnostics', () => {
  it.each([24, 2_048, 200_000])('deduplicates overlapping rules within each of %i rows, not the accumulated journal', count => {
    // Historical RK without VIK must remain visible once per joint. Correcting
    // a shared document can validate many such old positions in one operation.
    const rows = Array.from({ length: count }, (_, index) => ({
      id: index + 1, joint: `F${index + 1}`, weldDate: '2026-09-01',
      hasVik: 'да', hasRk: 'да', rkRequest: 'RK', rkRequestDate: '2026-09-02',
      rkResult: 'годен', rkConclusion: 'RK-C', rkConclusionDate: '2026-09-03',
    }))
    const some = Array.prototype.some
    let scannedCapacity = 0
    const spy = vi.spyOn(Array.prototype, 'some').mockImplementation(function(this: unknown[], predicate, thisArg) {
      if (this[0] && typeof this[0] === 'object' && 'kind' in this[0] && 'row' in this[0]) scannedCapacity += this.length
      return some.call(this, predicate, thisArg)
    })
    let issues: ReturnType<typeof getLnkChronologyIssues>
    try { issues = getLnkChronologyIssues(rows) } finally { spy.mockRestore() }
    expect(issues!).toHaveLength(count)
    expect(issues!.every((issue, index) => issue.row === rows[index] && issue.kind === 'vik-missing-before-other')).toBe(true)
    expect(scannedCapacity).toBeLessThanOrEqual(count * 10)
  }, 30_000)
})
