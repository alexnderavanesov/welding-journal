import { describe, expect, it } from 'vitest'
import { documentGridGroupSelection, mergeLoadedDocumentGridSelection, toggleLoadedDocumentGridSelection } from './document-grid-selection'

describe('loaded document group selection', () => {
  const rows = [
    { document: { id: 1 }, groupIds: ['outer'] },
    { document: { id: 2 }, groupIds: ['inner', 'outer'] },
    { document: { id: 3 }, groupIds: ['other'] },
  ]
  it('counts nested descendants for tri-state without including unrelated leaves', () => {
    expect(documentGridGroupSelection(rows, new Set(['1', '3']))).toEqual(new Map([
      ['outer', { loaded: 2, selected: 1 }], ['inner', { loaded: 1, selected: 0 }], ['other', { loaded: 1, selected: 1 }],
    ]))
    expect(documentGridGroupSelection([], new Set(['1']))).toEqual(new Map())
  })
  it('toggles the loaded subset once and keeps exact outside IDs through cache eviction', () => {
    const loaded = rows.slice(0, 2).map(row => row.document), previous = [{ id: 900 }, { id: 1 }]
    const selected = toggleLoadedDocumentGridSelection(previous, loaded)
    expect(selected).toEqual([{ id: 900 }, { id: 1 }, { id: 2 }])
    expect(toggleLoadedDocumentGridSelection(selected, loaded)).toEqual([{ id: 900 }])
    expect(toggleLoadedDocumentGridSelection(selected, [])).toEqual(selected)
    expect(mergeLoadedDocumentGridSelection(selected, [{ id: 1 }], new Set())).toEqual([{ id: 900 }, { id: 2 }])
  })
  it('keeps system string IDs exact and replaces selected snapshots with loaded versions', () => {
    expect(mergeLoadedDocumentGridSelection([{ id: 'outside', version: 1 }, { id: 'system:2', version: 1 }], [{ id: 'system:2', version: 2 }], new Set(['system:2'])))
      .toEqual([{ id: 'outside', version: 1 }, { id: 'system:2', version: 2 }])
  })
})
