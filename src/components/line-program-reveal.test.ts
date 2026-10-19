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
