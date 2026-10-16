import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { useJournalRangeSummary } from './use-journal-range-summary'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('yields during a large total, cancels it on a new model and cleans up on unmount', async () => {
  vi.useFakeTimers()
  let clock = 0, last = 99999
  vi.spyOn(performance, 'now').mockImplementation(() => clock += 5)
  const read = vi.fn(() => 2)
  const api = {
    isDestroyed: () => false,
    getCellRanges: () => [{ startRow: { rowIndex: 0 }, endRow: { rowIndex: last }, columns: [{ getColId: () => 'd1' }] }],
    getDisplayedRowCount: () => 100000,
    getDisplayedRowAtIndex: () => ({ data: { id: 1 } }),
    getCellValue: read,
  } as unknown as GridApi<WeldRow>
  const hook = renderHook(() => useJournalRangeSummary(api))
  act(() => hook.result.current.update())
  await act(() => vi.advanceTimersToNextFrame())
  expect(read).toHaveBeenCalledTimes(512)
  expect(hook.result.current.summary.count).toBe(0)
  last = 1
  act(() => hook.result.current.update())
  await act(() => vi.runAllTimersAsync())
  expect(hook.result.current.summary).toEqual({ count: 2, numericCount: 2, sum: 4, average: 2 })
  expect(read).toHaveBeenCalledTimes(514)
  last = 99999
  act(() => hook.result.current.update())
  await act(() => vi.advanceTimersToNextFrame())
  const reads = read.mock.calls.length
  hook.unmount()
  await act(() => vi.runAllTimersAsync())
  expect(read).toHaveBeenCalledTimes(reads)
})
