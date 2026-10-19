import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { journalGroupRangeValue, useJournalRangeSummary } from './use-journal-range-summary'
import type { IRowNode } from 'ag-grid-community'

it('distinguishes a numeric group key from a textual identifier and the empty-group label', () => {
  const group = (key: string | null, field: string) => ({ key, rowGroupColumn: { getColId: () => field } }) as IRowNode<WeldRow>
  expect(journalGroupRangeValue(group('45.6', 'wdi'), 'line', 'line')).toBe(45.6)
  expect(journalGroupRangeValue(group('001.2', 'line'), 'line', 'line')).toBe('001.2')
  expect(journalGroupRangeValue(group(null, 'line'), 'line', 'line')).toBe('(Пусто)')
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('yields during a large total, cancels it on a new model and cleans up on unmount', async () => {
  vi.useFakeTimers()
  let clock = 0, last = 99999
  vi.spyOn(performance, 'now').mockImplementation(() => clock += 5)
  const read = vi.fn(() => 2)
  const api = {
    isDestroyed: () => false,
    getCellRanges: () => [{ startRow: { rowIndex: 0 }, endRow: { rowIndex: last }, columns: [{ getColId: () => 'd1' }] }],
    forEachNode: (visit: (node: unknown) => void) => { for (let rowIndex = 0; rowIndex < 100000; rowIndex++) visit({ rowIndex, data: { id: rowIndex } }) },
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

it('counts selected group summaries, deduplicates overlapping ranges and never includes collapsed descendants', async () => {
  vi.useFakeTimers()
  const nodes = [
    { rowIndex: 0, group: true, key: '001.2', aggData: { wdi: 45.6, joint: 4 } },
    { rowIndex: 1, group: true, key: '002.2', aggData: { wdi: 55.6, joint: 5 } },
    { rowIndex: null, data: { id: 3, wdi: 1000 } },
  ]
  const read = vi.fn(() => { throw Error('No implicit descendant reads') })
  const ranges = [{ startRow: { rowIndex: 0 }, endRow: { rowIndex: 1 }, columns: [{ getColId: () => 'wdi' }] }]
  const api = { isDestroyed: () => false, forEachNode: (visit: (node: unknown) => void) => nodes.forEach(visit),
    getCellRanges: () => [...ranges, ...ranges], getCellValue: read } as unknown as GridApi<WeldRow>
  const hook = renderHook(() => useJournalRangeSummary(api))
  await act(() => vi.runAllTimersAsync())
  expect(hook.result.current.summary).toEqual({ count: 2, numericCount: 2, sum: 101.2, average: 50.6 })
  ranges[0].columns = [{ getColId: () => 'line' }, { getColId: () => 'joint' }]
  act(() => hook.result.current.update())
  await act(() => vi.runAllTimersAsync())
  expect(hook.result.current.summary).toEqual({ count: 4, numericCount: 2, sum: 9, average: 4.5 })
  expect(read).not.toHaveBeenCalled()
})
