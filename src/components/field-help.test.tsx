import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FieldHelp } from './field-help'
import { LargeDialogShell } from './large-dialog-shell'

afterEach(() => vi.restoreAllMocks())

it('keeps a newly opened help popup through a queued scroll and gives it the first Escape', () => {
  const closeDialog = vi.fn()
  render(<LargeDialogShell onEscape={closeDialog}>
    <div data-testid="scroll-area"><FieldHelp label="Пояснение">Текст подсказки</FieldHelp></div>
  </LargeDialogShell>)
  const trigger = screen.getByRole('button', { name: 'Пояснение' })
  vi.spyOn(trigger.parentElement!, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 80, 16, 16))
  fireEvent.click(trigger)
  expect(screen.getByRole('tooltip')).toBeVisible()
  // The browser can dispatch the scroll from bringing the button into view
  // after the click has opened its tooltip. Its anchor has already settled.
  fireEvent.scroll(screen.getByTestId('scroll-area'))
  expect(screen.getByRole('tooltip')).toBeVisible()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(closeDialog).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(closeDialog).toHaveBeenCalledOnce()
})

it('dismisses pinned help when scrolling actually moves its anchor', () => {
  render(<div data-testid="scroll-area"><FieldHelp label="Пояснение">Текст подсказки</FieldHelp></div>)
  const trigger = screen.getByRole('button', { name: 'Пояснение' })
  const bounds = vi.spyOn(trigger.parentElement!, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 80, 16, 16))
  fireEvent.click(trigger)
  bounds.mockReturnValue(new DOMRect(40, 40, 16, 16))
  fireEvent.scroll(screen.getByTestId('scroll-area'))
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
