import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProgramControlDetails } from './line-program-control-details'

afterEach(cleanup)
describe('separate control indicators', () => {
  it('does not dismiss before a pointer click without focus transfer', () => {
    const onAdditional = vi.fn()
    render(<ProgramControlDetails additional={11} onAdditional={onAdditional} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ещё показатели контроля' }))
    const focused = screen.getByRole('button', { name: 'Дополнительные стыки: 11' })
    const choice = screen.getByRole('button', { name: 'Дополнительные стыки: 11' })
    // Safari/macOS may blur the focused item without focusing the clicked button.
    // Dismissing on that blur unmounts the target before mouseup/click can reach it.
    fireEvent.pointerDown(choice)
    fireEvent.mouseDown(choice)
    fireEvent.blur(focused, { relatedTarget: null })
    expect(screen.getByRole('dialog')).toBeVisible()
    fireEvent.mouseUp(choice)
    fireEvent.click(choice)
    expect(onAdditional).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('omits empty details and only shows nonzero counters', () => {
    const props = { onAdditional: vi.fn() }
    const view = render(<ProgramControlDetails {...props} additional={0} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    view.rerender(<ProgramControlDetails {...props} additional={11} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ещё показатели контроля' }))
    const details = screen.getByRole('dialog')
    expect(within(details).queryByRole('button', { name: /Согласовано/ })).not.toBeInTheDocument()
    fireEvent.click(within(details).getByRole('button', { name: 'Дополнительные стыки: 11' }))
    expect(props.onAdditional).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('focuses the details, restores focus on Escape, dismisses on outside click, scroll and resize', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    render(<ProgramControlDetails additional={11} onAdditional={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Ещё показатели контроля' })
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: 'Дополнительные стыки: 11' })).toHaveFocus()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    focus.mockRestore()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    for (const dismiss of [() => fireEvent.pointerDown(document.body), () => fireEvent.resize(window), () => fireEvent.blur(window)]) {
      fireEvent.click(trigger)
      expect(screen.getByRole('dialog')).toBeVisible()
      dismiss()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  })
  it('ignores a delayed scroll from bringing the trigger into view, but closes when its anchor moves', () => {
    render(<ProgramControlDetails additional={11} onAdditional={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Ещё показатели контроля' })
    const rect = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 120, 56, 28))
    fireEvent.click(trigger)
    fireEvent.scroll(window)
    expect(screen.getByRole('dialog')).toBeVisible()
    rect.mockReturnValue(new DOMRect(40, 80, 56, 28))
    fireEvent.scroll(window)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('still dismisses when keyboard focus moves outside', () => {
    render(<><ProgramControlDetails additional={11} onAdditional={vi.fn()} /><button>За пределами меню</button></>)
    fireEvent.click(screen.getByRole('button', { name: 'Ещё показатели контроля' }))
    fireEvent.blur(screen.getByRole('button', { name: 'Дополнительные стыки: 11' }), { relatedTarget: screen.getByRole('button', { name: 'За пределами меню' }) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
