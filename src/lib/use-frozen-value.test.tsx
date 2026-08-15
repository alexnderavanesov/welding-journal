import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useFrozenValue } from '@/lib/use-frozen-value'

describe('useFrozenValue', () => {
  it('keeps the last interactive value while the background is frozen', () => {
    const first = { version: 1 }
    const second = { version: 2 }
    const third = { version: 3 }
    const { result, rerender } = renderHook(
      ({ value, frozen }) => useFrozenValue(value, frozen),
      { initialProps: { value: first, frozen: false } },
    )

    act(() => rerender({ value: second, frozen: true }))
    expect(result.current).toBe(first)

    act(() => rerender({ value: third, frozen: false }))
    expect(result.current).toBe(third)
  })
})
