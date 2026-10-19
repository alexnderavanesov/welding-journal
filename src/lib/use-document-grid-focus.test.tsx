import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { GridApi } from 'ag-grid-community'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextActionMenu } from '@/components/context-action-menu'
import { setContextActionMenuOpen } from './context-action-menu-state'
import { useDocumentGridFocus } from './use-document-grid-focus'

function setup() {
  const frame = document.createElement('div')
  const cell = document.createElement('div')
  cell.setAttribute('role', 'gridcell')
  cell.tabIndex = -1
  cell.innerHTML = '<button>Документ</button>'
  frame.append(cell)
  document.body.append(frame)
  const column = { getColId: () => 'title', isVisible: () => true }
  const node: { id: string; rowIndex: number | null } = { id: 'document:42', rowIndex: 9 }
  const api = {
    isDestroyed: () => false,
    getFocusedCell: () => ({ rowIndex: 9, column }),
    getDisplayedRowAtIndex: () => node,
    getColumn: vi.fn(() => column),
    getRowNode: vi.fn(() => node),
    setFocusedCell: vi.fn(() => cell.focus({ preventScroll: true })),
    setFocusedHeader: vi.fn(),
  }
  const hook = renderHook(() => useDocumentGridFocus(api as unknown as GridApi, { current: frame }))
  act(() => { cell.focus(); hook.result.current.remember() })
  return { ...hook, cell, frame, api, column, node }
}

afterEach(() => {
  cleanup()
  setContextActionMenuOpen(false)
  document.body.replaceChildren()
})

describe('document grid focus restoration', () => {
  it('returns to the title cell after the real context menu autofocus and Escape', async () => {
    const { cell, api } = setup()
    function Menu() {
      const [open, setOpen] = useState(true)
      return <ContextActionMenu autoFocus menu={open ? {
        x: 0, y: 0, anchorElement: cell,
        items: [{ id: 'download', label: 'Скачать', onSelect: () => {} }],
      } : null} onClose={() => setOpen(false)} />
    }
    const menu = render(<Menu />)
    expect(menu.getByRole('button', { name: 'Скачать' })).toHaveFocus()
    // Let the body observer record the open portal before closing it.
    await act(async () => {})
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(cell).toHaveFocus())
    expect(api.setFocusedCell).toHaveBeenCalledWith(9, expect.anything())
    expect(cell.querySelector('button')).not.toHaveFocus()
  })

  it('resolves the remembered document after sorting instead of using its old index', () => {
    const { result, api, node, column } = setup()
    node.rowIndex = 25
    act(() => result.current.restore())
    expect(api.getRowNode).toHaveBeenCalledWith('document:42')
    expect(api.setFocusedCell).toHaveBeenCalledWith(25, column)
  })

  it('keeps the remembered cell while an AG filter has focus in its body popup layer', () => {
    const { result, api, column } = setup()
    const popup = document.createElement('div'), input = document.createElement('input')
    popup.className = 'document-grid-popup-layer'
    popup.append(input); document.body.append(popup)
    act(() => { input.focus(); popup.remove(); result.current.restore() })
    expect(api.setFocusedCell).toHaveBeenCalledWith(9, column)
  })

  it('does not steal focus after the user leaves the grid for another control', () => {
    const { result, api } = setup()
    const outside = document.createElement('button')
    document.body.append(outside)
    act(() => { outside.focus(); outside.blur(); result.current.restore() })
    expect(api.setFocusedCell).not.toHaveBeenCalled()
  })

  it('uses the column header if the remembered document was removed', () => {
    const { result, api, node, column } = setup()
    node.rowIndex = null
    act(() => result.current.restore())
    expect(api.setFocusedCell).not.toHaveBeenCalled()
    expect(api.setFocusedHeader).toHaveBeenCalledWith(column)
  })
})
