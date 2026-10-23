import { afterEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_DOCUMENT_HISTORY_COLUMNS } from './document-history-columns'
import { DOCUMENT_GRID_ACTIONS_COLUMN, DOCUMENT_GRID_DEFAULT_APPEARANCE, normalizeDocumentGridColumns, readDocumentGridState, writeDocumentGridState } from './document-history-grid-state'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
describe('document grid personal state', () => {
  it('restores action-column layout while excluding actions from data sorting and grouping', () => {
    const available = [...SYSTEM_DOCUMENT_HISTORY_COLUMNS, DOCUMENT_GRID_ACTIONS_COLUMN]
    const columns = normalizeDocumentGridColumns([{ colId: '__actions', width: 310, pinned: 'left', hide: true, sort: 'asc', sortIndex: 0, rowGroup: true, rowGroupIndex: 0 }, { colId: 'title' }], available)
    expect(columns[0]).toMatchObject({ colId: '__actions', width: 310, pinned: 'left', hide: true, sort: null, sortIndex: null, rowGroup: false, rowGroupIndex: null })
    expect(normalizeDocumentGridColumns([{ colId: 'title' }], available).at(-1)).toMatchObject({ colId: '__actions', width: 205, pinned: 'right', hide: false })
  })
  it('keeps state isolated between registries and preserves grouping, sort and hidden columns', () => {
    writeDocumentGridState('system:lnkConclusion:lnk', { columns: [{ colId: 'line', hide: true, rowGroup: true, rowGroupIndex: 0, sort: 'asc' }], appearance: { ...DOCUMENT_GRID_DEFAULT_APPEARANCE, density: 'compact' }, views: [] })
    expect(readDocumentGridState('system:lnkConclusion:lnk', SYSTEM_DOCUMENT_HISTORY_COLUMNS)).toMatchObject({ columns: [{ colId: 'line', hide: true, rowGroup: true, sort: 'asc' }], appearance: { density: 'compact' } })
    expect(readDocumentGridState('system:pstoConclusion:null', SYSTEM_DOCUMENT_HISTORY_COLUMNS).columns).toEqual([])
  })
  it('rejects unknown/stale layout fields, duplicate columns and invalid required-column hiding', () => {
    const columns = normalizeDocumentGridColumns([{ colId: 'title', hide: true, width: -1, rowGroup: true }, { colId: 'title', width: 999 }, { colId: 'retired' }, { colId: 'line', pinned: 'middle', width: 9000 }], SYSTEM_DOCUMENT_HISTORY_COLUMNS)
    expect(columns).toHaveLength(2)
    expect(columns[0]).toMatchObject({ colId: 'title', hide: false, width: 80, rowGroup: false })
    expect(columns[1]).toMatchObject({ colId: 'line', pinned: null, width: 1600 })
  })
  it('retains saved view filters on hidden columns and tolerates unavailable browser storage', () => {
    const state = { columns: [{ colId: 'line', hide: true }], appearance: DOCUMENT_GRID_DEFAULT_APPEARANCE, views: [{ id: 'v', name: 'Линия', columns: [{ colId: 'line', hide: true }], appearance: DOCUMENT_GRID_DEFAULT_APPEARANCE, filters: { line: 'L-1' }, search: 'документ' }] }
    writeDocumentGridState('generated:zni', state)
    expect(readDocumentGridState('generated:zni', SYSTEM_DOCUMENT_HISTORY_COLUMNS).views[0]).toMatchObject({ filters: { line: 'L-1' }, search: 'документ', columns: [{ colId: 'line', hide: true }] })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    expect(() => writeDocumentGridState('generated:zni', state)).not.toThrow()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    expect(readDocumentGridState('generated:zni', SYSTEM_DOCUMENT_HISTORY_COLUMNS).columns).toEqual([])
  })
  it('restores the 51st saved view and retains every valid view across repeated reloads', () => {
    const views = Array.from({ length: 51 }, (_, index) => ({
      id: `view-${index + 1}`, name: `Вид ${index + 1}`,
      columns: [{ colId: 'line', hide: true, width: 280 + index }],
      appearance: { ...DOCUMENT_GRID_DEFAULT_APPEARANCE },
      filters: { line: `Линия ${index + 1}` }, search: `документ ${index + 1}`,
    }))
    writeDocumentGridState('generated:zni', { columns: [], appearance: DOCUMENT_GRID_DEFAULT_APPEARANCE, views })
    const restored = readDocumentGridState('generated:zni', SYSTEM_DOCUMENT_HISTORY_COLUMNS)
    expect(restored.views.map(view => view.id)).toEqual(views.map(view => view.id))
    expect(restored.views[50]).toMatchObject(views[50])
    writeDocumentGridState('generated:zni', restored)
    expect(readDocumentGridState('generated:zni', SYSTEM_DOCUMENT_HISTORY_COLUMNS).views).toEqual(restored.views)
  })
})
