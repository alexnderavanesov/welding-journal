import { describe, expect, it, vi } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'

function repairRows(count: number): WeldRow[] {
  return Array.from({ length: count / 2 }, (_, index) => {
    const id = index * 2 + 1
    const base = { connectionType: 'С17', line: 'L1', weldDate: '2026-09-01', stamp1K: 'A', hasVik: 'да', vikResult: 'годен', hasRk: 'да' }
    return [
      { ...base, id, joint: `F${id}`, rkResult: 'ремонт' },
      { ...base, id: id + 1, joint: `F${id}R1`, hasUzk: 'да', hasPvk: 'да' },
    ]
  }).flat()
}

describe('repair surplus accounting at journal scale', () => {
  it.each([24, 2_048, 200_000])('does not rescan growing ID arrays for %i source/repair rows', count => {
    const rows = repairRows(count)
    let scannedCapacity = 0
    const includes = Array.prototype.includes
    const spy = vi.spyOn(Array.prototype, 'includes').mockImplementation(function(this: unknown[], value: unknown, from?: number) {
      if (typeof value === 'number' && typeof this[0] === 'number') scannedCapacity += this.length
      return includes.call(this, value, from)
    })
    let groups: ReturnType<typeof calculateLineProgram>
    try { groups = calculateLineProgram(rows, 10, 0) } finally { spy.mockRestore() }
    // Each rejected primary contributes once. R1 has no percentage weight;
    // only its optional UZK/PVK are surplus, never inherited mandatory RK.
    expect(groups![0].rowIds).toHaveLength(count / 2)
    expect(groups![0].common.excessAssignments).toHaveLength(count / 2)
    expect(groups![0].common.excessAssignments?.every(item => item.method === 'УЗК')).toBe(true)
    expect(groups![0].pvk.excessAssignments).toHaveLength(count / 2)
    expect(new Set(groups![0].contextRowIds).size).toBe(count)
    expect(scannedCapacity).toBeLessThanOrEqual(count * 100)
  }, 30_000)
})
