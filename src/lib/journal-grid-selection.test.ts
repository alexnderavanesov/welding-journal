import { describe, expect, it, vi } from 'vitest'
import type { GridApi, IRowNode } from 'ag-grid-community'
import { restoreJournalGridSelection } from './journal-grid-selection'

type Row = { id: number }
function node(id: number, selected: boolean, group = false) {
  return { id: String(id), data: { id }, group, isSelected: () => selected } as IRowNode<Row>
}
function grid(nodes: IRowNode<Row>[]) {
  const byId = new Map(nodes.map(row => [row.id, row]))
  const selected = nodes.filter(row => row.isSelected())
  const api = {
    getRowNode: vi.fn((id: string) => byId.get(id)),
    getSelectedNodes: vi.fn(() => selected),
    setNodesSelected: vi.fn<Parameters<typeof restoreJournalGridSelection<Row>>[0]['setNodesSelected']>(),
  } satisfies Pick<GridApi<Row>, 'getRowNode' | 'getSelectedNodes' | 'setNodesSelected'>
  return api
}

describe('journal selection work follows selected records, not loaded rows', () => {
  it('checks one selected record with 200000 loaded rows and keeps unloaded IDs', () => {
    const rows = Array.from({ length: 200_000 }, (_, index) => node(index + 1, index === 6))
    const api = grid(rows), ids = new Set([7, 300_000])
    restoreJournalGridSelection(api, ids)
    expect(api.getRowNode).toHaveBeenCalledTimes(2)
    expect(api.getSelectedNodes).toHaveBeenCalledTimes(1)
    expect(api.setNodesSelected).not.toHaveBeenCalled()
    expect([...ids]).toEqual([7, 300_000])
  })

  it('batches both directions, ignores groups and never reselects matching leaves', () => {
    const keep = node(1, true), add = node(2, false), remove = node(3, true), group = node(4, true, true)
    const api = grid([keep, add, remove, group])
    restoreJournalGridSelection(api, new Set([1, 2, 4]))
    expect(api.setNodesSelected).toHaveBeenCalledTimes(2)
    expect(api.setNodesSelected).toHaveBeenNthCalledWith(1, { nodes: [remove], newValue: false })
    expect(api.setNodesSelected).toHaveBeenNthCalledWith(2, { nodes: [add], newValue: true })
  })

  it('clears native selection and applies it again after a selected row reloads', () => {
    const selected = node(1, true), api = grid([selected])
    restoreJournalGridSelection(api, new Set())
    expect(api.getRowNode).not.toHaveBeenCalled()
    expect(api.setNodesSelected).toHaveBeenLastCalledWith({ nodes: [selected], newValue: false })
    const reloaded = node(1, false)
    api.getRowNode.mockReturnValue(reloaded); api.getSelectedNodes.mockReturnValue([])
    restoreJournalGridSelection(api, new Set([1]))
    expect(api.setNodesSelected).toHaveBeenLastCalledWith({ nodes: [reloaded], newValue: true })
  })
})
