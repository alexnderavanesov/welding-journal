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
