import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useDocumentEscapeKey } from './use-document-escape-key'

afterEach(cleanup)
function escape(prevented = false) {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  if (prevented) event.preventDefault()
  act(() => { window.dispatchEvent(event) })
  return event
}
it('clears selections first, filters second, and ignores disabled or already handled keys', () => {
  const onClearSelection = vi.fn(), onClearFilters = vi.fn()
  const props = { selectedCount: 3, hasFilters: true, onClearSelection, onClearFilters, enabled: true }
  const { rerender } = renderHook(useDocumentEscapeKey, { initialProps: props })
  escape(true)
  expect(onClearSelection).not.toHaveBeenCalled()
  expect(escape().defaultPrevented).toBe(true)
  expect(onClearSelection).toHaveBeenCalledOnce()
  expect(onClearFilters).not.toHaveBeenCalled()
  rerender({ ...props, selectedCount: 0 })
  escape()
  expect(onClearFilters).toHaveBeenCalledOnce()
  rerender({ ...props, enabled: false })
  expect(escape().defaultPrevented).toBe(false)
})
it('leaves selections and filters behind a modal intact', () => {
  const onClearSelection = vi.fn(), onClearFilters = vi.fn()
  renderHook(() => useDocumentEscapeKey({ selectedCount: 1, hasFilters: true, onClearSelection, onClearFilters }))
  const modal = document.createElement('div'); modal.dataset.modalDialog = 'true'; document.body.append(modal)
  escape(); modal.remove()
  expect(onClearSelection).not.toHaveBeenCalled()
  expect(onClearFilters).not.toHaveBeenCalled()
})
