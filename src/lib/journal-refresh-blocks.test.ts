import { expect, it } from 'vitest'
import type { GridApi, IRowNode } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { collectJournalRefreshBlocks, journalRefreshBlocksUnchanged, planJournalBlockRefresh } from './journal-refresh-blocks'
import type { JournalGridResult } from './journal-server-grid'

const leaf = (id: number, rowIndex: number, parent?: object) => ({ data: { id, joint: `F${id}` }, rowIndex, parent }) as IRowNode<WeldRow>
function grid(nodes: IRowNode<WeldRow>[], stores = [{ route: [] as string[], rowCount: 2, lastRowIndexKnown: true }]) {
  return { forEachNode: (visit: (node: IRowNode<WeldRow>) => void) => nodes.forEach(visit), getServerSideGroupLevelState: () => stores } as GridApi<WeldRow>
}
it('compares server-derived metadata and updates only changed records in the same positions', () => {
  const nodes = [leaf(1, 0), leaf(2, 1)]
  const blocks = collectJournalRefreshBlocks(grid(nodes))!
  const result = { rows: [nodes[0].data!, { ...nodes[1].data!, finalStatus: 'годен' }], rowCount: 2, revision: 7 }
  expect(planJournalBlockRefresh(blocks, [result])).toEqual([{ route: [], refresh: false, update: [result.rows[1]] }])
  expect(journalRefreshBlocksUnchanged(blocks, collectJournalRefreshBlocks(grid(nodes)))).toBe(true)
  expect(journalRefreshBlocksUnchanged(blocks, collectJournalRefreshBlocks(grid([leaf(1, 0), nodes[1]])))).toBe(false)
})
it.each([
  { ids: [2, 1], count: 2 }, // changed sort
  { ids: [1, 3], count: 2 }, // moved/filtered row, unchanged count
  { ids: [1], count: 1 }, // deletion
  { ids: [1, 2, 3], count: 3 }, // creation
  { ids: [], count: 0 }, // last member removed
])('refreshes membership changes: %o', ({ ids, count }) => {
  const blocks = collectJournalRefreshBlocks(grid([leaf(1, 0), leaf(2, 1)]))!
  expect(planJournalBlockRefresh(blocks, [{ rows: ids.map(id => ({ id })), rowCount: count, revision: 8 }])[0].refresh).toBe(true)
})
it('rejects unloaded holes and unknown extents, while supporting a partial final block', () => {
  expect(collectJournalRefreshBlocks(grid([leaf(1, 0)]))).toBeNull()
  expect(collectJournalRefreshBlocks(grid([leaf(1, 0)], [{ route: [], rowCount: 1, lastRowIndexKnown: false }]))).toBeNull()
  const nodes = [leaf(201, 200), leaf(202, 201)]
  expect(collectJournalRefreshBlocks(grid(nodes, [{ route: [], rowCount: 202, lastRowIndexKnown: true }]))).toMatchObject([{ start: 200, end: 300, nodes }])
})
it('keeps nested group ordinals distinct from display offsets and refreshes only a changed store', () => {
  const parent = { rowIndex: 4, getRoute: () => ['P', 'L'] }
  const nodes = [leaf(1, 5, parent), leaf(2, 6, parent)]
  const group = { data: { id: 0, journalGroup: { route: ['P'], ordinal: 0, childCount: 1 } }, rowIndex: 0 } as unknown as IRowNode<WeldRow>
  const api = grid([group, ...nodes], [{ route: [], rowCount: 1, lastRowIndexKnown: true }, { route: ['P', 'L'], rowCount: 2, lastRowIndexKnown: true }])
  const blocks = collectJournalRefreshBlocks(api)!
  const results = [{ rows: [group.data!], rowCount: 1, revision: 3 }, { rows: [], rowCount: 0, revision: 3 }] as JournalGridResult[]
  expect(blocks.map(block => [block.route, block.start])).toEqual([[[], 0], [['P', 'L'], 0]])
  expect(planJournalBlockRefresh(blocks, results).map(plan => [plan.route, plan.refresh])).toEqual([[[], false], [['P', 'L'], true]])
})
