import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentGridCheckbox } from './document-grid-checkbox'

afterEach(cleanup)

describe('document grid themed checkbox', () => {
  it('keeps the native input state and AG theme classes aligned for unchecked, mixed, checked and disabled controls', () => {
    const change = vi.fn()
    const view = render(<DocumentGridCheckbox aria-label="Загруженные документы" checked={false} onChange={change} />)
    const input = screen.getByRole('checkbox', { name: 'Загруженные документы' }), wrapper = input.parentElement!
    expect(input).toHaveClass('ag-input-field-input', 'ag-checkbox-input')
    expect(wrapper).toHaveClass('document-grid-checkbox', 'ag-checkbox-input-wrapper')
    expect(wrapper).not.toHaveClass('ag-checked', 'ag-indeterminate', 'ag-disabled')
    view.rerender(<DocumentGridCheckbox aria-label="Загруженные документы" checked={false} indeterminate onChange={change} />)
    expect(input).toBePartiallyChecked()
    expect(wrapper).toHaveClass('ag-indeterminate')
    expect(wrapper).not.toHaveClass('ag-checked')
    view.rerender(<DocumentGridCheckbox aria-label="Загруженные документы" checked onChange={change} />)
    expect(input).toBeChecked()
    expect(input).not.toBePartiallyChecked()
    expect(wrapper).toHaveClass('ag-checked')
    expect(wrapper).not.toHaveClass('ag-indeterminate')
    view.rerender(<DocumentGridCheckbox aria-label="Загруженные документы" checked disabled onChange={change} />)
    expect(input).toBeDisabled()
    expect(wrapper).toHaveClass('ag-checked', 'ag-disabled')
    ;(input as HTMLInputElement).click()
    expect(change).not.toHaveBeenCalled()
  })

  it('preserves input selectors, focus and caller keyboard/click handling without adding a second selection event', () => {
    const change = vi.fn(), click = vi.fn(), keyboard = vi.fn()
    render(<DocumentGridCheckbox aria-label="Группа" className="document-grid-group-checkbox" title="Только загруженные" checked={false}
      onChange={change} onClick={click} onKeyDown={keyboard} tabIndex={0} />)
    const input = screen.getByRole('checkbox', { name: 'Группа' })
    expect(input).toHaveClass('document-grid-group-checkbox')
    expect(input).toHaveAttribute('title', 'Только загруженные')
    input.focus()
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'F2' })
    expect(keyboard).toHaveBeenCalledTimes(1)
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(input)
    expect(change).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
  })
})
