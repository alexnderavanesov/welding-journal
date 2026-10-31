import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { JournalServerSelectionContext, JournalServerSelectionHeader } from './journal-server-selection'

it('activates the extended checkbox area once and blocks it while selection is pending', () => {
  const toggle = vi.fn()
  const view = (pending: boolean, selectedTotal = 0) => <JournalServerSelectionContext.Provider value={{ ids: new Set(), counts: {}, selectedTotal, pending, toggle }}>
    <JournalServerSelectionHeader />
  </JournalServerSelectionContext.Provider>
  const { rerender } = render(view(false))
  const input = screen.getByRole('checkbox') as HTMLInputElement
  const wrapper = input.parentElement!
  // JSDOM exercises native label activation; browser regressions separately
  // cover CSS hit testing and real pointer down/up at all four edges.
  fireEvent.click(wrapper)
  expect(toggle).toHaveBeenCalledTimes(1)
  fireEvent.click(input)
  expect(toggle).toHaveBeenCalledTimes(2)
  rerender(view(true, 1))
  expect(input.indeterminate).toBe(true)
  fireEvent.click(wrapper)
  fireEvent.click(input)
  expect(toggle).toHaveBeenCalledTimes(2)
  rerender(view(false, 1))
  fireEvent.click(wrapper)
  expect(toggle).toHaveBeenCalledTimes(3)
  expect(input).toHaveFocus()
})
