import { describe, expect, it } from 'vitest'
import { selectDocumentGridRowRange, type DocumentGridRowRangeNode, type DocumentGridRowRangeState } from './document-grid-row-range'

type Row = { id: number; title: string }
const row = (id: number): Row => ({ id, title: `Документ ${id}` })
const leaf = (id: number, rowIndex: number): DocumentGridRowRangeNode<Row> => ({ id: `document:${id}`, rowIndex, data: row(id) })
const nodes = [leaf(1, 0), { id: 'group:0', rowIndex: 1, group: true }, leaf(2, 2),
  { id: 'group:1', rowIndex: 3, group: true }, leaf(3, 4), leaf(4, 5)]
const state = (anchor = 1, end: number | null = null): DocumentGridRowRangeState => ({ anchorId: `document:${anchor}`, endId: end == null ? null : `document:${end}` })
const ids = (result: { selected: Row[] }) => result.selected.map(item => item.id).sort((a, b) => a - b)

describe('document cached row Shift range', () => {
  it('crosses groups without selecting them or dropping off-cache selection', () => {
    const result = selectDocumentGridRowRange({ nodes, selected: [row(1), row(999)], state: state(), targetId: 'document:3' })
    expect(ids(result)).toEqual([1, 2, 3, 999])
    expect(result.state).toEqual(state(1, 3))
  })

  it('extends and shortens the same range while preserving unrelated selected rows', () => {
    const first = selectDocumentGridRowRange({ nodes, selected: [row(1), row(999)], state: state(), targetId: 'document:3' })
    const longer = selectDocumentGridRowRange({ nodes, ...first, targetId: 'document:4' })
    expect(ids(longer)).toEqual([1, 2, 3, 4, 999])
    const shorter = selectDocumentGridRowRange({ nodes, ...longer, targetId: 'document:2' })
    expect(ids(shorter)).toEqual([1, 2, 999])
    expect(shorter.state).toEqual(state(1, 2))
  })

  it('handles upward extension, shortening and changing sides of the anchor', () => {
    const upward = selectDocumentGridRowRange({ nodes, selected: [row(3), row(999)], state: state(3), targetId: 'document:1' })
    expect(ids(upward)).toEqual([1, 2, 3, 999])
    const shorter = selectDocumentGridRowRange({ nodes, ...upward, targetId: 'document:2' })
    expect(ids(shorter)).toEqual([2, 3, 999])
    const reversed = selectDocumentGridRowRange({ nodes, ...shorter, targetId: 'document:4' })
    expect(ids(reversed)).toEqual([3, 4, 999])
    expect(reversed.state).toEqual(state(3, 4))
  })

  it('plain Shift from a deselected anchor resets the earlier selection, including off-cache IDs', () => {
    const result = selectDocumentGridRowRange({ nodes, selected: [row(4), row(999)], state: state(), targetId: 'document:3' })
    expect(ids(result)).toEqual([1, 2, 3])
  })

  it('Ctrl/Meta+Shift from a deselected anchor removes the range and preserves other IDs', () => {
    const result = selectDocumentGridRowRange({ nodes, selected: [row(2), row(3), row(4), row(999)], state: state(), targetId: 'document:3', metaKey: true })
    expect(ids(result)).toEqual([4, 999])
    expect(result.state).toEqual(state(1, 3))
  })

  it('Ctrl/Meta+Shift from a selected anchor extends and shortens as plain Shift', () => {
    const result = selectDocumentGridRowRange({ nodes, selected: [row(1), row(999)], state: state(), targetId: 'document:4', metaKey: true })
    const shorter = selectDocumentGridRowRange({ nodes, ...result, targetId: 'document:2', metaKey: true })
    expect(ids(shorter)).toEqual([1, 2, 999])
  })

  it('plain Shift with a missing anchor selects only the target; Ctrl/Meta+Shift does nothing', () => {
    const input = { nodes, selected: [row(999)], state: state(998), targetId: 'document:3' }
    expect(ids(selectDocumentGridRowRange(input))).toEqual([3, 999])
    expect(selectDocumentGridRowRange(input).state).toEqual(state(3))
    expect(selectDocumentGridRowRange({ ...input, metaKey: true })).toEqual({ selected: input.selected, state: input.state })
  })

  it.each([undefined, { id: 'stub', rowIndex: 1, stub: true }])('does not select a partial range across a missing cache slot (%s)', gap => {
    const partial = [leaf(1, 0), ...(gap ? [gap] : []), leaf(2, 2), leaf(3, 3)]
    const result = selectDocumentGridRowRange({ nodes: partial, selected: [row(1), row(999)], state: state(), targetId: 'document:3' })
    expect(ids(result)).toEqual([1, 3, 999])
    expect(result.state).toEqual(state(3))
  })

  it('uses native reset/deselect behavior when a gap interrupts an unselected-anchor range', () => {
    const partial = [leaf(1, 0), leaf(3, 3)]
    const input = { nodes: partial, selected: [row(3), row(999)], state: state(), targetId: 'document:3' }
    expect(ids(selectDocumentGridRowRange(input))).toEqual([3])
    expect(ids(selectDocumentGridRowRange({ ...input, metaKey: true }))).toEqual([999])
  })

  it('ignores group/disabled targets and treats disabled leaves as covered but not selectable', () => {
    const input = { nodes: [...nodes, { ...leaf(5, 6), selectable: false }, leaf(6, 7)], selected: [row(1)], state: state() }
    for (const targetId of ['group:0', 'group:1', 'document:5', 'missing']) {
      expect(selectDocumentGridRowRange({ ...input, targetId })).toEqual({ selected: input.selected, state: input.state })
    }
    expect(ids(selectDocumentGridRowRange({ ...input, targetId: 'document:6' }))).toEqual([1, 2, 3, 4, 6])
  })

  it('resolves identities against the current order and ignores hidden/pinned nodes', () => {
    const reordered = [leaf(3, 0), leaf(2, 1), leaf(1, 2), { ...leaf(4, 3), rowIndex: null }, { ...leaf(999, 1), rowPinned: 'top' }]
    expect(ids(selectDocumentGridRowRange({ nodes: reordered, selected: [row(1)], state: state(), targetId: 'document:3' }))).toEqual([1, 2, 3])
  })

  it('does not mutate snapshots or descriptors and replaces selected cached rows with current data', () => {
    const old = Object.freeze({ id: 1, title: 'Старое название' })
    const selected = Object.freeze([old, Object.freeze(row(999))])
    const cached = Object.freeze(nodes.map(node => Object.freeze(node)))
    const result = selectDocumentGridRowRange({ nodes: cached, selected, state: Object.freeze(state()), targetId: 'document:2' })
    expect(result.selected.find(item => item.id === 1)?.title).toBe('Документ 1')
    expect(result.selected.find(item => item.id === 999)).toBe(selected[1])
    expect(selected[0].title).toBe('Старое название')
  })

  it('handles a 200000-row display gap by inspecting only the 100 supplied cache descriptors', () => {
    let reads = 0
    const cached = Array.from({ length: 100 }, (_, index) => ({ ...leaf(index + 1, index === 99 ? 199_999 : index),
      get rowIndex() { reads++; return index === 99 ? 199_999 : index },
    }))
    const result = selectDocumentGridRowRange({ nodes: cached, selected: [row(1)], state: state(), targetId: 'document:100' })
    expect(ids(result)).toEqual([1, 100])
    expect(reads).toBeLessThan(2_000)
  })
})
