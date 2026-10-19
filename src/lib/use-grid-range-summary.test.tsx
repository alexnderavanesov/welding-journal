import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GridApi, IRowNode } from 'ag-grid-community'
import { useGridRangeSummary } from './use-grid-range-summary'

afterEach(() => vi.useRealTimers())
it('totals a 200000-row server range using only cached visible cells without probing or loading missing blocks', async () => {
  vi.useFakeTimers()
  type Row = { wdi: number }
  const nodes = [
    { rowIndex: 0, group: true }, { rowIndex: 1, stub: true },
    { rowIndex: null, data: { wdi: 999 } }, { rowIndex: 2, footer: true },
    ...Array.from({ length: 100 }, (_, index) => ({ rowIndex: 199900 + index, data: { wdi: 12.5 } })),
  ]
  const probe = vi.fn(() => { throw Error('Must not load missing rows') })
  const api = { isDestroyed: () => false, forEachNode: (visit: (node: unknown) => void) => nodes.forEach(visit),
    getCellRanges: () => [{ startRow: { rowIndex: 199999 }, endRow: { rowIndex: 0 }, columns: [{ getColId: () => 'wdi' }] }],
    getDisplayedRowAtIndex: probe, getDisplayedRowCount: probe,
  } as unknown as GridApi<Row>
  const read = vi.fn((node: IRowNode<Row>) => node.group ? undefined : node.data?.wdi)
  const allowed = new Set(['wdi']), numeric = () => true
  const hook = renderHook(() => useGridRangeSummary(api, allowed, read, numeric))
  await act(() => vi.runAllTimersAsync())
  expect(hook.result.current.summary).toEqual({ count: 100, numericCount: 100, sum: 1250, average: 12.5 })
  expect(read).toHaveBeenCalledTimes(101)
  expect(probe).not.toHaveBeenCalled()
})
