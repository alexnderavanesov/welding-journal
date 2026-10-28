import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Select } from './select'
import { useWindowEscapeKey } from '@/lib/use-window-escape-key'

afterEach(cleanup)

it('searches anywhere in a stamp without changing its value until selection', () => {
  const change = vi.fn(), escape = vi.fn()
  function Form() {
    useWindowEscapeKey(true, escape)
    return <Select searchable aria-label="Корень_1" defaultValue="LIVE" onChange={change}>
      <option value="">Пусто</option><option value="LIVE">LIVE</option><option value="ABC0">ABC0</option>
      <option value="BAD0" disabled title="не подходит по диаметру">BAD0</option>
    </Select>
  }
  render(<Form />)
  const select = screen.getByRole('combobox', { name: 'Корень_1' })
  fireEvent.click(select)
  const search = screen.getByRole('combobox', { name: 'Поиск: Корень_1' })
  expect(search).toHaveFocus()
  fireEvent.change(search, { target: { value: '0' } })
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.textContent)).toEqual(['ABC0', 'BAD0'])
  expect(select).toHaveValue('LIVE')
  const blocked = within(screen.getByRole('listbox')).getByRole('option', { name: 'BAD0' })
  expect(blocked).toHaveAttribute('aria-disabled', 'true')
  expect(blocked).toHaveAttribute('title', expect.stringContaining('не подходит по диаметру'))
  fireEvent.click(blocked)
  expect(change).not.toHaveBeenCalled()
  fireEvent.change(search, { target: { value: 'bc0' } })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(select).toHaveValue('ABC0')
  expect(change).toHaveBeenCalledOnce()
  expect(select).toHaveFocus()
  fireEvent.click(select)
  fireEvent.change(screen.getByRole('combobox', { name: 'Поиск: Корень_1' }), { target: { value: 'unknown' } })
  expect(screen.getByText('Ничего не найдено')).toBeVisible()
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Поиск: Корень_1' }), { key: 'Enter' })
  expect(select).toHaveValue('ABC0')
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Поиск: Корень_1' }), { key: 'Escape' })
  expect(escape).not.toHaveBeenCalled()
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.click(select)
  expect(screen.getByRole('combobox', { name: 'Поиск: Корень_1' })).toHaveValue('')
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Пусто' }))
  expect(select).toHaveValue('')
})

it('filters the entire bounded list and closes stale search results when availability changes', () => {
  const options = (disabled = false) => Array.from({ length: 2000 }, (_, i) => <option key={i} value={i} disabled={disabled && i === 1999}>Клеймо {i}</option>)
  const view = (disabled = false) => <Select searchable aria-label="Клеймо" defaultValue="0">{options(disabled)}</Select>
  const { rerender } = render(view())
  fireEvent.click(screen.getByRole('combobox', { name: 'Клеймо' }))
  expect(within(screen.getByRole('listbox')).getAllByRole('option').length).toBeLessThan(25)
  fireEvent.change(screen.getByRole('combobox', { name: 'Поиск: Клеймо' }), { target: { value: '1999' } })
  expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'Клеймо 1999' })).toBeVisible()
  rerender(view(true))
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(screen.getByRole('combobox', { name: 'Клеймо' })).toHaveValue('0')
})

it('can clear a selected last stamp when the empty option is outside the virtual viewport', () => {
  render(<Select searchable aria-label="Клеймо" defaultValue="1999"><option value="">Пусто</option>
    {Array.from({ length: 2000 }, (_, i) => <option key={i} value={i}>Клеймо {i}</option>)}
  </Select>)
  const select = screen.getByRole('combobox', { name: 'Клеймо' })
  fireEvent.click(select)
  const list = screen.getByRole('listbox')
  expect(within(list).queryByRole('option', { name: 'Пусто' })).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: 'Поиск: Клеймо' }), { target: { value: 'Пусто' } })
  expect(select).toHaveValue('1999')
  fireEvent.click(within(list).getByRole('option', { name: 'Пусто' }))
  expect(select).toHaveValue('')
})

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
