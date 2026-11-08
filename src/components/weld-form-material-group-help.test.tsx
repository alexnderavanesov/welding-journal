import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WeldFormMaterialGroupHelp } from './weld-form-material-group-help'

afterEach(() => vi.restoreAllMocks())

it('shows help on hover/focus and dismisses it without an inline note', () => {
  const { container } = render(<WeldFormMaterialGroupHelp />)
  const button = screen.getByRole('button', { name: 'Как выбрать группы материалов' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.mouseEnter(button)
  expect(screen.getByRole('tooltip')).toHaveTextContent('1 — D1/T1, 2 — D2/T2')
  expect(container).not.toContainElement(screen.getByRole('tooltip'))
  expect(button).toHaveAttribute('aria-expanded', 'true')
  fireEvent.mouseLeave(button)
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.focus(button)
  expect(screen.getByRole('tooltip')).toBeVisible()
  fireEvent.keyDown(button, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('pins help on click, toggles it off, and dismisses on outside click or scroll', () => {
  render(<WeldFormMaterialGroupHelp />)
  const button = screen.getByRole('button')
  const bounds = vi.spyOn(button.parentElement!, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 80, 16, 16))
  fireEvent.click(button)
  fireEvent.mouseLeave(button)
  expect(screen.getByRole('tooltip')).toBeVisible()
  fireEvent.click(button)
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.click(button)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.click(button)
  bounds.mockReturnValue(new DOMRect(40, 40, 16, 16))
  fireEvent.scroll(window)
  expect(screen.queryByRole('tooltip')).toBeNull()
})
