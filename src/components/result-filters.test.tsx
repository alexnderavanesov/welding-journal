import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResultFilters } from '@/components/result-filters'

describe('ResultFilters', () => {
  it('keeps the selected-row switch and bulk action inside the filter toolbar', () => {
    render(
      <ResultFilters
        search=""
        requestKey=""
        requestOptions={[]}
        filteredRowsCount={0}
        selectedRowsCount={0}
        leading={<button type="button">Выбрано: 0</button>}
        action={<button type="button">Выбрать доступные</button>}
        showClearFilters={false}
        onSearchChange={vi.fn()}
        onRequestChange={vi.fn()}
        onClearFilters={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Выбрано: 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выбрать доступные' })).toBeInTheDocument()
  })

  it('keeps row search buffered and filters the request picker immediately', () => {
    vi.useFakeTimers()
    try {
      const onSearchChange = vi.fn()
      render(
        <ResultFilters
          search=""
          requestKey=""
          requestOptions={[
            { key: 'one', name: 'Заявка-010', date: '2026-08-28', label: 'Заявка-010 · 28.08.2026' },
            { key: 'two', name: 'Заявка-011', date: '2026-08-29', label: 'Заявка-011 · 29.08.2026' },
          ]}
          filteredRowsCount={702}
          selectedRowsCount={0}
          showClearFilters={false}
          onSearchChange={onSearchChange}
          onRequestChange={vi.fn()}
          onClearFilters={vi.fn()}
        />,
      )

      const rowsSearch = screen.getByPlaceholderText('Проект, шифр, линия, спул или стык')
      const requestSearch = screen.getByRole('combobox', { name: 'Заявка' })
      fireEvent.change(rowsSearch, { target: { value: 'F16' } })
      fireEvent.change(requestSearch, { target: { value: '011' } })

      expect(rowsSearch).toHaveValue('F16')
      expect(requestSearch).toHaveValue('011')
      expect(screen.getByRole('option', { name: /Заявка-011/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /Заявка-010/ })).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(179))
      expect(onSearchChange).not.toHaveBeenCalled()

      act(() => vi.advanceTimersByTime(1))
      expect(onSearchChange).toHaveBeenLastCalledWith('F16')
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the exact request selected from the searchable picker', () => {
    const onRequestChange = vi.fn()
    render(
      <ResultFilters
        search=""
        requestKey=""
        requestOptions={[
          { key: 'two', name: 'Заявка-011', date: '2026-08-29', label: 'Заявка-011 · 29.08.2026' },
        ]}
        filteredRowsCount={1}
        selectedRowsCount={0}
        showClearFilters={false}
        onSearchChange={vi.fn()}
        onRequestChange={onRequestChange}
        onClearFilters={vi.fn()}
      />,
    )

    fireEvent.focus(screen.getByRole('combobox', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('option', { name: /Заявка-011/ }))

    expect(onRequestChange).toHaveBeenCalledWith(expect.objectContaining({ key: 'two' }))
  })
})
