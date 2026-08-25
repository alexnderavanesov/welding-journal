import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { usePagePagination } from '@/lib/use-page-pagination'

describe('usePagePagination', () => {
  it('keeps a fixed number of mounted rows while moving between pages', () => {
    const items = Array.from({ length: 137 }, (_, index) => index + 1)
    const { result } = renderHook(() => usePagePagination({ items }))

    expect(result.current.pageItems).toEqual(items.slice(0, 50))
    expect(result.current.pageCount).toBe(3)
    expect(result.current.firstItemNumber).toBe(1)
    expect(result.current.lastItemNumber).toBe(50)

    act(() => result.current.goToNextPage())
    expect(result.current.pageItems).toEqual(items.slice(50, 100))
    expect(result.current.firstItemNumber).toBe(51)
    expect(result.current.lastItemNumber).toBe(100)

    act(() => result.current.goToNextPage())
    expect(result.current.pageItems).toEqual(items.slice(100))
    expect(result.current.firstItemNumber).toBe(101)
    expect(result.current.lastItemNumber).toBe(137)
  })

  it('returns to the first page after the page size changes', () => {
    const items = Array.from({ length: 80 }, (_, index) => index + 1)
    const { result } = renderHook(() => usePagePagination({ items }))

    act(() => result.current.goToNextPage())
    act(() => result.current.setPageSize(25))

    expect(result.current.page).toBe(1)
    expect(result.current.pageSize).toBe(25)
    expect(result.current.pageItems).toEqual(items.slice(0, 25))
  })
})
