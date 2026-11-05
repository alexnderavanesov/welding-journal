import { describe, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import type { LineProgramRecord } from '@/lib/line-program'
import { revealProgramLine } from './line-program-reveal'

const target = { id: 7, version: '2026-10-19T00:00:01.000Z' }
function grid(version: string | null, matches = false) {
  const node = version ? { data: { ...target, version }, parent: null as unknown } : undefined
  const api = {
    isDestroyed: () => false, getRowNode: vi.fn(() => node), setFilterModel: vi.fn(),
    forEachNodeAfterFilter: vi.fn(callback => { if (matches) callback(node) }),
  }
  return { node, calls: api, api: api as unknown as GridApi<LineProgramRecord> }
}
describe('explicit program target', () => {
  it.each([null, '2026-10-19T00:00:00.000Z'])('waits for a missing or stale row (%s)', version => {
    const state = grid(version)
    expect(revealProgramLine(state.api, target)).toBe(false)
    expect(state.calls.setFilterModel).not.toHaveBeenCalled()
  })
  it.each([target.version, '2026-10-19T00:00:02.000Z'])('reveals the saved or concurrently newer row (%s)', version => {
    const state = grid(version)
    expect(revealProgramLine(state.api, target)).toBe(true)
    expect(state.calls.setFilterModel).toHaveBeenCalledExactlyOnceWith(null)
    expect(state.node?.data.version).toBe(version)
  })
  it('opens collapsed ancestors in order while retaining a matching filter', () => {
    const state = grid(target.version, true), opened: number[] = []
    const root = { group: true, level: -1, parent: null, expanded: false, setExpanded: vi.fn() }
    const outer = { group: true, level: 0, parent: root, expanded: false, setExpanded: () => opened.push(0) }
    state.node!.parent = { group: true, level: 1, parent: outer, expanded: false, setExpanded: () => opened.push(1) }
    expect(revealProgramLine(state.api, target)).toBe(true)
    expect(opened).toEqual([0, 1])
    expect(root.setExpanded).not.toHaveBeenCalled()
    expect(state.calls.setFilterModel).not.toHaveBeenCalled()
  })
})

import { revealProgramComposition } from './line-program-reveal'
it('removes only filters hiding any member of the exact composition, opens parents and ignores stale transitions', async () => {
  const opened = vi.fn()
  const parent = { group: true, level: 0, parent: null, expanded: false, setExpanded: opened }
  const nodes = [1, 2].map(id => ({ id: String(id), data: { id }, parent }))
  const cleared = vi.fn(), applied = vi.fn()
  const api = { isDestroyed: () => false, getRowNode: (id: string) => nodes.find(node => node.id === id), getFilterModel: () => ({ good: {}, hidesSecond: {} }),
    getColumnFilterInstance: async (column: string) => ({ doesFilterPass: ({ data }: { data: { id: number } }) => column === 'good' || data.id === 1 }),
    setColumnFilterModel: cleared, getColumn: (id: string) => ({ getColDef: () => ({ headerName: id }) }), onFilterChanged: applied } as unknown as GridApi
  expect(await revealProgramComposition(api, ['1', '2'])).toEqual(['hidesSecond'])
  expect(cleared).toHaveBeenCalledExactlyOnceWith('hidesSecond', null)
  expect(applied).toHaveBeenCalledOnce(); expect(opened).toHaveBeenCalledOnce()
  cleared.mockClear()
  expect(await revealProgramComposition(api, ['1', '2'], () => false)).toEqual([])
  expect(await revealProgramComposition(api, ['1', 'missing'])).toEqual([])
  expect(cleared).not.toHaveBeenCalled()
})
