import { describe, expect, it } from 'vitest'
import { programDetailOwnsHeader } from './line-program-sticky-headers'

describe('line program sticky header handoff', () => {
  it('returns the overview when the final child releases its header, including detail padding', () => {
    for (const childBottom of [90, 74, 73, 72, 57, 20, 0]) {
      const childOwns = childBottom > 73 // 36px context + 37px joint columns
      const parentYields = programDetailOwnsHeader(
        { top: -500, bottom: childBottom + 17 }, 92, 56,
        [{ bottom: childBottom, headerBottom: 73 }],
      )
      // Every position at the outgoing edge has exactly one header owner;
      // the extra 17px of detail border/padding cannot extend the child's turn.
      expect(parentYields).toBe(childOwns)
    }
  })

  it('hands joint columns to stamp columns before the next stamp row', () => {
    expect(programDetailOwnsHeader({ top: -600, bottom: 74 }, 77, 77,
      [{ bottom: 72, headerBottom: 73 }])).toBe(false)
    expect(programDetailOwnsHeader({ top: -600, bottom: 76 }, 77, 77,
      [{ bottom: 74, headerBottom: 73 }])).toBe(true)
  })

  it('leaves an incoming expanded line heading clear before its child table arrives', () => {
    expect(programDetailOwnsHeader({ top: 58, bottom: 800 }, 92, 56,
      [{ bottom: 780, headerBottom: 77 }])).toBe(true)
    expect(programDetailOwnsHeader({ top: 120, bottom: 800 }, 92, 56,
      [{ bottom: 780, headerBottom: 77 }])).toBe(false)
  })

  it('does not reclaim the header while a later visible child still continues', () => {
    expect(programDetailOwnsHeader({ top: -900, bottom: 600 }, 92, 56,
      [{ bottom: 20, headerBottom: 73 }, { bottom: 580, headerBottom: 73 }])).toBe(true)
  })

  it('uses the same handoff for a short empty child and for loading content without a grid', () => {
    expect(programDetailOwnsHeader({ top: -30, bottom: 89 }, 92, 56,
      [{ bottom: 72, headerBottom: 73 }])).toBe(false)
    expect(programDetailOwnsHeader({ top: -30, bottom: 100 }, 92, 56, [])).toBe(true)
    expect(programDetailOwnsHeader({ top: -60, bottom: 56 }, 92, 56, [])).toBe(false)
  })
})
