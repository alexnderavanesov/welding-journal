import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { useJournalGridFocus } from './use-journal-grid-focus'

afterEach(() => document.body.replaceChildren())

function setup() {
  const element = document.createElement('div')
  element.innerHTML = '<div class="ag-cell" tabindex="0"></div>'
  document.body.append(element)
  const column = { getColId: () => 'line', isVisible: () => true }
  const setFocusedCell = vi.fn()
  const api = { getFocusedCell: () => ({ rowIndex: 0, column }),
    getDisplayedRowAtIndex: () => ({ id: 'original' }),
    getRowNode: () => ({ rowIndex: 4 }), getColumn: () => column,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    isDestroyed: () => false, setFocusedCell } as unknown as GridApi<WeldRow>
  const hook = renderHook(() => useJournalGridFocus(api, { current: element }))
  act(() => hook.result.current.remember())
  return { hook, element, setFocusedCell, column }
}

it('restores the remembered record by ID when closing a portal leaves body focused', () => {
  const { hook, setFocusedCell, column } = setup()
  act(() => hook.result.current.restore())
  expect(setFocusedCell).toHaveBeenCalledWith(4, column)
})

it('does not replay delayed restoration once the user is already navigating grid cells', () => {
  const { hook, element, setFocusedCell } = setup()
  // Keyboard focus may move before AG Grid delivers its queued focused-cell event.
  element.querySelector<HTMLElement>('.ag-cell')!.focus()
  act(() => hook.result.current.restore())
  expect(setFocusedCell).not.toHaveBeenCalled()
})

it('does not steal focus from another control or an open dialog', () => {
  const { hook, setFocusedCell } = setup()
  const button = document.createElement('button')
  document.body.append(button)
  button.focus()
  act(() => hook.result.current.restore())
  expect(setFocusedCell).not.toHaveBeenCalled()
  button.remove()
  const modal = document.createElement('div')
  modal.dataset.modalDialog = 'true'
  document.body.append(modal)
  act(() => hook.result.current.restore())
  expect(setFocusedCell).not.toHaveBeenCalled()
})

it.each(['wheel', 'pointerdown', 'keydown'])('respects a newer %s action while earlier group rows are loading', event => {
  const grid = document.createElement('div')
  grid.innerHTML = '<div class="ag-row" row-index="1"><div class="ag-cell" col-id="select"><label class="journal-server-checkbox"><input type="checkbox"></label></div></div>'
  document.body.append(grid)
  const node = { rowIndex: 1 }
  const setFocusedCell = vi.fn(), clearFocusedCell = vi.fn()
  const addEventListener = vi.fn<(name: string, callback: () => void) => void>()
  const api = { addEventListener, removeEventListener: vi.fn(), isDestroyed: () => false,
    getDisplayedRowAtIndex: () => node, getFocusedCell: () => ({ rowIndex: 1, column: { getColId: () => 'select' } }),
    setFocusedCell, clearFocusedCell } as unknown as GridApi<WeldRow>
  renderHook(() => useJournalGridFocus(api, { current: grid }))
  const onModelUpdated = addEventListener.mock.calls.find(([name]) => name === 'modelUpdated')![1]
  act(() => {
    grid.querySelector('input')!.click()
    window.dispatchEvent(new Event(event))
    node.rowIndex = 7
    onModelUpdated()
  })
  expect(setFocusedCell).not.toHaveBeenCalled()
  expect(clearFocusedCell).not.toHaveBeenCalled()
})
