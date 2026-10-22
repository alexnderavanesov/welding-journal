import { expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { createJournalCacheBudget } from './journal-cache-budget'

it('evicts cold leaf cards while preserving extent, visible groups, focus and range endpoints', () => {
  const budget = createJournalCacheBudget(20)
  const parents = Array.from({ length: 5 }, (_, i) => ({ data: { journalGroup: { route: [String(i)] } }, rowIndex: i * 1001, expanded: true }))
  const nodes = parents.flatMap(parent => Array.from({ length: 10 }, () => ({ parent, data: { id: 1 } })))
  for (let i = 0; i < 5; i++) budget.loaded([String(i)], 1000)
  const events: unknown[] = []
  const api = { isDestroyed: () => false, getRowGroupColumns: () => [{}], getFirstDisplayedRowIndex: () => 4500, getLastDisplayedRowIndex: () => 4520,
    getFocusedCell: () => ({ rowIndex: 2010 }), getCellRanges: () => [{ startRow: { rowIndex: 1010 }, endRow: { rowIndex: 1020 } }],
    forEachNode: (visit: (node: unknown) => void) => nodes.forEach(visit), refreshServerSide: (args: unknown) => events.push(args),
    applyServerSideRowData: (args: unknown) => events.push(args),
  } as unknown as GridApi<WeldRow>
  expect(budget.trim(api)).toBe(20) // protected stores can exceed the soft budget
  expect(events).toEqual([
    { route: ['0'], purge: true }, { route: ['0'], startRow: 0, successParams: { rowData: [], rowCount: 1000 } },
    { route: ['3'], purge: true }, { route: ['3'], startRow: 0, successParams: { rowData: [], rowCount: 1000 } },
  ])
})
it('never purges a store without a known exact extent or after reset', () => {
  const budget = createJournalCacheBudget(0), purge = vi.fn()
  const api = { isDestroyed: () => false, getRowGroupColumns: () => [{}], getFirstDisplayedRowIndex: () => 5000, getLastDisplayedRowIndex: () => 5010,
    getFocusedCell: () => null, getCellRanges: () => [], refreshServerSide: purge,
    forEachNode: (visit: (node: unknown) => void) => visit({ data: {}, parent: { data: { journalGroup: { route: ['L'] } }, expanded: true, rowIndex: 0 } }),
  } as unknown as GridApi<WeldRow>
  expect(budget.trim(api)).toBe(0)
  budget.loaded(['L'], 1000); budget.clear(); expect(budget.trim(api)).toBe(0); expect(purge).not.toHaveBeenCalled()
})
