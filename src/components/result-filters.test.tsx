import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResultFilters } from '@/components/result-filters'

describe('ResultFilters', () => {
  it('keeps the selected-row switch and bulk action inside the filter toolbar', () => {
    render(
      <ResultFilters
        search=""
        requestSearch=""
        requestKey=""
        filteredRequestOptions={[]}
        availableRequestOptionsCount={0}
        filteredRowsCount={0}
        selectedRowsCount={0}
        leading={<button type="button">Выбрано: 0</button>}
        action={<button type="button">Выбрать доступные</button>}
        showClearFilters={false}
        onSearchChange={vi.fn()}
        onRequestSearchChange={vi.fn()}
        onRequestChange={vi.fn()}
        onClearRequestSearch={vi.fn()}
        onClearFilters={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Выбрано: 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выбрать доступные' })).toBeInTheDocument()
  })

  it('keeps both search inputs responsive and commits them after a short pause', () => {
    vi.useFakeTimers()
    try {
      const onSearchChange = vi.fn()
      const onRequestSearchChange = vi.fn()
      render(
        <ResultFilters
          search=""
          requestSearch=""
          requestKey=""
          filteredRequestOptions={[]}
          availableRequestOptionsCount={0}
          filteredRowsCount={702}
          selectedRowsCount={0}
          showClearFilters={false}
          onSearchChange={onSearchChange}
          onRequestSearchChange={onRequestSearchChange}
          onRequestChange={vi.fn()}
          onClearRequestSearch={vi.fn()}
          onClearFilters={vi.fn()}
        />,
      )

      const rowsSearch = screen.getByPlaceholderText('Проект, шифр, линия, спул или стык')
      const requestSearch = screen.getByPlaceholderText('Поиск заявки')
      fireEvent.change(rowsSearch, { target: { value: 'F16' } })
      fireEvent.change(requestSearch, { target: { value: '011' } })

      expect(rowsSearch).toHaveValue('F16')
      expect(requestSearch).toHaveValue('011')
      act(() => vi.advanceTimersByTime(179))
      expect(onSearchChange).not.toHaveBeenCalled()
      expect(onRequestSearchChange).not.toHaveBeenCalled()

      act(() => vi.advanceTimersByTime(1))
      expect(onSearchChange).toHaveBeenLastCalledWith('F16')
      expect(onRequestSearchChange).toHaveBeenLastCalledWith('011')
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves both values when their delayed commits overlap', () => {
    vi.useFakeTimers()
    try {
      function ControlledFilters() {
        const [search, setSearch] = useState('F16A')
        const [requestSearch, setRequestSearch] = useState('')
        return (
          <ResultFilters
            search={search}
            requestSearch={requestSearch}
            requestKey=""
            filteredRequestOptions={[]}
            availableRequestOptionsCount={0}
            filteredRowsCount={702}
            selectedRowsCount={0}
            showClearFilters={false}
            onSearchChange={setSearch}
            onRequestSearchChange={setRequestSearch}
            onRequestChange={vi.fn()}
            onClearRequestSearch={vi.fn()}
            onClearFilters={vi.fn()}
          />
        )
      }

      render(<ControlledFilters />)
      const rowsSearch = screen.getByPlaceholderText('Проект, шифр, линия, спул или стык')
      const requestSearch = screen.getByPlaceholderText('Поиск заявки')

      fireEvent.change(rowsSearch, { target: { value: '' } })
      act(() => vi.advanceTimersByTime(100))
      fireEvent.change(requestSearch, { target: { value: '011' } })
      act(() => vi.advanceTimersByTime(180))

      expect(rowsSearch).toHaveValue('')
      expect(requestSearch).toHaveValue('011')
    } finally {
      vi.useRealTimers()
    }
  })
})
