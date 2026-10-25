import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Select } from './select'
import { useWindowEscapeKey } from '@/lib/use-window-escape-key'

afterEach(cleanup)

it('keeps the popup open across parent refreshes with the same choices, closing only when choices change', () => {
  const view = (label = 'Первый') => <Select aria-label="Тип" value="a" onChange={() => {}}><option value="a">{label}</option><option value="b">Второй</option></Select>
  const { rerender } = render(view())
  fireEvent.click(screen.getByLabelText('Тип'))
  rerender(view())
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  rerender(view('Обновлённый'))
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('does not replace keyboard navigation when the popup appears under a stationary pointer', () => {
  render(<Select aria-label="Тип" defaultValue="b"><option value="a">Первый</option><option value="b">Второй</option></Select>)
  const select = screen.getByRole('combobox')
  fireEvent.keyDown(select, { key: 'ArrowDown' })
  fireEvent.keyDown(select, { key: 'Home' })
  fireEvent.mouseEnter(within(screen.getByRole('listbox')).getByRole('option', { name: 'Второй' }))
  fireEvent.keyDown(select, { key: 'Enter' })
  expect(select).toHaveValue('a')
})

it('selects a controlled value in the custom popup and keeps form/label semantics', () => {
  const change = vi.fn()
  function Form() {
    const [value, setValue] = useState('a')
    return <form data-testid="form"><label>Тип<Select name="kind" value={value} onChange={event => { change(event.target.value); setValue(event.target.value) }}><option value="a">Первый</option><option value="b">Второй</option></Select></label></form>
  }
  render(<Form />)
  const select = screen.getByLabelText('Тип')
  fireEvent.click(select)
  expect(select).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Второй' }))
  expect(select).toHaveValue('b')
  expect(new FormData(screen.getByTestId('form') as HTMLFormElement).get('kind')).toBe('b')
  expect(change).toHaveBeenCalledExactlyOnceWith('b')
  expect(select).toHaveFocus()
  fireEvent.click(select)
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Второй' }))
  expect(change).toHaveBeenCalledTimes(1)
})

it('keeps disabled options/groups unavailable and supports keyboard search, Escape and Tab', () => {
  const change = vi.fn(), parentEscape = vi.fn()
  function Form() {
    useWindowEscapeKey(true, parentEscape)
    return <Select aria-label="Тип" defaultValue="a" onChange={change}><option value="a">Первый</option><option value="b" disabled>Второй</option><optgroup label="Группа" disabled><option value="c">Третий</option></optgroup><option value="d">Четвёртый</option></Select>
  }
  render(<Form />)
  const select = screen.getByLabelText('Тип')
  fireEvent.keyDown(select, { key: 'ArrowDown' })
  fireEvent.keyDown(select, { key: 'ArrowDown' })
  fireEvent.keyDown(select, { key: 'Enter' })
  expect(select).toHaveValue('d')
  fireEvent.keyDown(select, { key: 'П' })
  fireEvent.keyDown(select, { key: 'Enter' })
  expect(select).toHaveValue('a')
  fireEvent.click(select)
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Третий' }))
  expect(select).toHaveValue('a')
  fireEvent.keyDown(select, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(parentEscape).not.toHaveBeenCalled()
  fireEvent.keyDown(select, { key: 'Escape' })
  expect(parentEscape).toHaveBeenCalledOnce()
  fireEvent.click(select)
  fireEvent.keyDown(select, { key: 'Tab' })
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('respects disabled fieldsets and bounds long option lists while reaching the last item', () => {
  const options = Array.from({ length: 2000 }, (_, i) => <option key={i} value={i}>Строка {i}</option>)
  const { rerender } = render(<fieldset disabled><Select aria-label="Список">{options}</Select></fieldset>)
  fireEvent.click(screen.getByLabelText('Список'))
  expect(screen.queryByRole('listbox')).toBeNull()
  rerender(<fieldset><Select aria-label="Список">{options}</Select></fieldset>)
  const select = screen.getByLabelText('Список')
  fireEvent.click(select)
  expect(within(screen.getByRole('listbox')).getAllByRole('option').length).toBeLessThan(25)
  fireEvent.keyDown(select, { key: 'End' })
  expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'Строка 1999' })).toBeInTheDocument()
  fireEvent.keyDown(select, { key: 'Enter' })
  expect(select).toHaveValue('1999')
  fireEvent.click(select)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('listbox')).toBeNull()
})
