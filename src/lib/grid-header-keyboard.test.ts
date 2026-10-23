import { beforeEach, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import { gridHeaderKeyboard } from './grid-header-keyboard'
const columns = ['selection', 'title', 'count'].map(id => ({ getColId: () => id }))
const api = { setFocusedHeader: vi.fn(), ensureColumnVisible: vi.fn(), getAllDisplayedColumns: () => columns,
  getColumn: () => ({ isFilterAllowed: () => true }), showColumnFilter: vi.fn() }
function key(markup: string, key: string, overrides = {}) {
  document.body.innerHTML = markup
  return { key, target: document.querySelector('[data-target]')!, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides }
}
beforeEach(() => vi.clearAllMocks())
it('moves from a first-row checkbox to its own header without changing selection', () => {
  const event = key('<div row-index="0"><div class="ag-cell" col-id="selection"><input type="checkbox" data-target></div></div>', 'ArrowUp')
  expect(gridHeaderKeyboard(event, api as unknown as GridApi)).toBe(true)
  expect(api.setFocusedHeader).toHaveBeenCalledWith('selection')
  expect(event.preventDefault).toHaveBeenCalledOnce()
})
it('keeps native editors and modified navigation untouched', () => {
  for (const markup of ['<div row-index="0"><div class="ag-cell" col-id="title"><input data-target></div></div>',
    '<div class="ag-menu"><div class="ag-header-cell" col-id="title" data-target></div></div>']) {
    const event = key(markup, 'ArrowUp')
    expect(gridHeaderKeyboard(event, api as unknown as GridApi)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  }
  expect(gridHeaderKeyboard(key('<div class="ag-header-cell" col-id="title" data-target></div>', 'ArrowRight', { shiftKey: true }), api as unknown as GridApi)).toBe(false)
})
it('reveals the adjacent visible header and opens its filter once per space press', () => {
  const markup = '<div class="ag-header-cell" col-id="title" data-target></div>'
  gridHeaderKeyboard(key(markup, 'ArrowRight'), api as unknown as GridApi)
  expect(api.ensureColumnVisible).toHaveBeenCalledWith(columns[2])
  const opened = vi.fn()
  gridHeaderKeyboard(key(markup, ' '), api as unknown as GridApi, { openFilter: opened })
  gridHeaderKeyboard(key(markup, ' ', { repeat: true }), api as unknown as GridApi, { openFilter: opened })
  expect(opened).toHaveBeenCalledExactlyOnceWith('title')
  expect(api.showColumnFilter).toHaveBeenCalledExactlyOnceWith('title')
})
it('uses an existing selection command without creating one for other tables', () => {
  const markup = '<div class="ag-header-cell" col-id="ag-Grid-SelectionColumn" data-target></div>', toggle = vi.fn()
  gridHeaderKeyboard(key(markup, ' '), api as unknown as GridApi, { toggleSelection: toggle })
  gridHeaderKeyboard(key(markup, ' ', { repeat: true }), api as unknown as GridApi, { toggleSelection: toggle })
  expect(toggle).toHaveBeenCalledOnce()
  expect(api.showColumnFilter).not.toHaveBeenCalled()
})
