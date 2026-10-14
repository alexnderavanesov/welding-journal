import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SpecialistPicker } from './specialist-picker'
import { shouldDeferModalEscape } from '@/lib/use-report-modal-escape-key'
import type { SpecialistRecord } from '@/lib/document-specialists'

const records: SpecialistRecord[] = [
  { id: 1, name: 'Иванов Иван', certificate: 'НК-11', kind: 'inspector', methods: ['ВИК'], revision: 0 },
  { id: 2, name: 'Петров Пётр', certificate: 'НК-22', kind: 'inspector', methods: ['ВИК'], revision: 0 },
]
const base = { label: 'Провёл контроль', records, allowKeep: true, disabled: false, compact: false }

describe('specialist picker', () => {
  it('keeps search inside the popup and returns from search to keyboard choices', () => {
    render(<SpecialistPicker {...base} value={undefined} onChange={vi.fn()} search={<input type="search" aria-label="Поиск" />} />)
    const picker = screen.getByRole('combobox')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    fireEvent.click(picker)
    const search = screen.getByRole('searchbox')
    search.focus()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(picker).toHaveFocus()
    search.focus()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(picker).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
  it('scrolls the active option inside the list without scrolling modal ancestors', () => {
    render(<SpecialistPicker {...base} value={undefined} onChange={vi.fn()} />)
    const picker = screen.getByRole('combobox')
    fireEvent.click(picker)
    const list = screen.getByRole('listbox').parentElement!
    const option = screen.getByRole('option', { name: 'Очистить назначение' })
    const scrollIntoView = vi.fn()
    Object.defineProperties(option, { offsetTop: { value: 500 }, offsetHeight: { value: 48 }, scrollIntoView: { value: scrollIntoView } })
    Object.defineProperty(list, 'clientHeight', { value: 100 })
    fireEvent.keyDown(picker, { key: 'ArrowDown' })
    expect(list.scrollTop).toBe(448)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(picker).toHaveAttribute('aria-expanded', 'true')
  })

  it('ignores queued scroll events while the anchor stays put, but closes after actual movement', () => {
    render(<SpecialistPicker {...base} value={undefined} onChange={vi.fn()} />)
    const picker = screen.getByRole('combobox')
    const rect = { x: 20, y: 40, left: 20, top: 40, right: 300, bottom: 80, width: 280, height: 40, toJSON: () => ({}) }
    const bounds = vi.spyOn(picker, 'getBoundingClientRect').mockReturnValue(rect)
    fireEvent.click(picker)
    fireEvent.scroll(document)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.scroll(window)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    bounds.mockReturnValue({ ...rect, top: 30, bottom: 70, y: 30 })
    fireEvent.scroll(window)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('distinguishes keep, clear, and a person; leaves keyboard focus on the trigger', () => {
    const onChange = vi.fn()
    render(<SpecialistPicker {...base} value={undefined} onChange={onChange} />)
    const picker = screen.getByRole('combobox')
    picker.focus()
    fireEvent.keyDown(picker, { key: 'Enter' })
    expect(shouldDeferModalEscape()).toBe(true)
    expect(screen.getByRole('option', { name: 'Не изменять' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(picker, { key: 'ArrowDown' })
    fireEvent.keyDown(picker, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(picker).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.click(picker)
    fireEvent.click(screen.getByRole('option', { name: 'Не изменять' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    fireEvent.keyDown(picker, { key: 'ArrowDown' })
    fireEvent.keyDown(picker, { key: 'End' })
    fireEvent.keyDown(picker, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(2)
  })

  it('Escape, Tab and outside pointer dismiss without a change; supports type-ahead', () => {
    const onChange = vi.fn()
    render(<SpecialistPicker {...base} value={1} selected={records[0]} onChange={onChange} />)
    const picker = screen.getByRole('combobox')
    fireEvent.click(picker)
    fireEvent.keyDown(picker, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(shouldDeferModalEscape()).toBe(false)
    fireEvent.click(picker)
    fireEvent.keyDown(picker, { key: 'Tab' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.click(picker)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(picker, { key: 'П' })
    fireEvent.keyDown(picker, { key: 'е' })
    fireEvent.keyDown(picker, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(2)
  })

  it('preserves a selected name outside search results; renders no list when disabled', () => {
    const view = render(<SpecialistPicker {...base} value={1} records={[]} selected={records[0]} onChange={vi.fn()} />)
    const picker = screen.getByRole('combobox')
    expect(picker).toHaveTextContent('Иванов Иван')
    fireEvent.click(picker)
    expect(screen.queryByRole('option', { name: 'Иванов Иван' })).not.toBeInTheDocument()
    view.rerender(<SpecialistPicker {...base} value={null} records={[]} allowKeep={false} disabled onChange={vi.fn()} />)
    expect(picker).toBeDisabled()
    expect(picker).toHaveTextContent('Не назначен')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
