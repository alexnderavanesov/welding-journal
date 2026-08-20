import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildWindowTableRenderState,
  useWindowTableVirtualization,
} from '@/lib/use-window-table-virtualization'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('window table virtualization', () => {
  it('keeps the complete list when virtualization is disabled', () => {
    const rows = [{ id: 1 }, { id: 2 }]
    expect(
      buildWindowTableRenderState({
        enabled: false,
        rows,
        scrollMargin: 100,
        totalSize: 500,
        virtualItems: [],
      }),
    ).toEqual({
      rowIndexes: [0, 1],
      visibleRows: rows,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      virtualized: false,
    })
  })

  it('returns visible rows and spacer heights without changing source indexes', () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ id: index + 1 }))
    const state = buildWindowTableRenderState({
      enabled: true,
      rows,
      scrollMargin: 200,
      totalSize: 500,
      virtualItems: [
        { index: 3, key: 4, start: 350, end: 400, size: 50, lane: 0 },
        { index: 4, key: 5, start: 400, end: 450, size: 50, lane: 0 },
      ],
    })

    expect(state.visibleRows).toEqual([{ id: 4 }, { id: 5 }])
    expect(state.rowIndexes).toEqual([3, 4])
    expect(state.topSpacerHeight).toBe(150)
    expect(state.bottomSpacerHeight).toBe(250)
    expect(state.virtualized).toBe(true)
  })

  it('does not render the whole dataset before the viewport is measured', () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({ id: index + 1 }))
    const state = buildWindowTableRenderState({
      enabled: true,
      rows,
      scrollMargin: 0,
      totalSize: 25_000,
      virtualItems: [],
    })

    expect(state.visibleRows).toHaveLength(16)
    expect(state.rowIndexes).toEqual(Array.from({ length: 16 }, (_, index) => index))
    expect(state.bottomSpacerHeight).toBe(24_200)
    expect(state.virtualized).toBe(true)
  })

  it('keeps only the nearby part of a long table in the React render tree', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const rows = Array.from({ length: 500 }, (_, index) => ({ id: index + 1 }))
    const { result } = renderHook(() =>
      useWindowTableVirtualization({
        rows,
        estimateRowHeight: 50,
        overscan: 8,
      }),
    )

    await waitFor(() => expect(result.current.virtualized).toBe(true))
    expect(result.current.visibleRows.length).toBeGreaterThan(0)
    expect(result.current.visibleRows.length).toBeLessThan(rows.length)
    expect(result.current.topSpacerHeight + result.current.bottomSpacerHeight).toBeGreaterThan(0)
  })
})
