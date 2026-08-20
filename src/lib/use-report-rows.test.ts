import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { reuseEquivalentWeldRows } from '@/lib/use-report-rows'

describe('reuseEquivalentWeldRows', () => {
  it('preserves references for unchanged rows and replaces only a changed row', () => {
    const previous = [
      { id: 1, joint: 'S1', line: 'L1' },
      { id: 2, joint: 'S2', line: 'L1' },
    ] as WeldRow[]
    const next = [
      { id: 1, joint: 'S1', line: 'L1' },
      { id: 2, joint: 'S2-new', line: 'L1' },
    ] as WeldRow[]

    const result = reuseEquivalentWeldRows(previous, next)

    expect(result[0]).toBe(previous[0])
    expect(result[1]).toBe(next[1])
  })

  it('treats an unchanged shallow array as equivalent', () => {
    const control = { id: 10 }
    const previous = [{ id: 1, duplicateControls: [control] }] as unknown as WeldRow[]
    const next = [{ id: 1, duplicateControls: [control] }] as unknown as WeldRow[]

    expect(reuseEquivalentWeldRows(previous, next)[0]).toBe(previous[0])
  })
})
