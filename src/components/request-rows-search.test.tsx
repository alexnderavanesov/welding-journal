import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RequestRowsSearch } from '@/components/request-rows-search'

describe('RequestRowsSearch', () => {
  it('keeps typing immediate and ignores a stale parent acknowledgement', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const { rerender } = render(
        <RequestRowsSearch
          value=""
          label="Стыки"
          placeholder="Найти стык"
          filteredCount={12}
          availableCount={10}
          action={<button type="button">Выбрать доступные</button>}
          onChange={onChange}
        />,
      )
      const input = screen.getByPlaceholderText('Найти стык')

      fireEvent.change(input, { target: { value: 'Ри' } })

      expect(input).toHaveValue('Ри')
      act(() => vi.advanceTimersByTime(179))
      expect(onChange).not.toHaveBeenCalled()

      act(() => vi.advanceTimersByTime(1))
      expect(onChange).toHaveBeenLastCalledWith('Ри')

      fireEvent.change(input, { target: { value: 'Риф' } })
      rerender(
        <RequestRowsSearch
          value="Ри"
          label="Стыки"
          placeholder="Найти стык"
          filteredCount={5}
          availableCount={4}
          action={<button type="button">Выбрать доступные</button>}
          onChange={onChange}
        />,
      )

      expect(input).toHaveValue('Риф')
      act(() => vi.advanceTimersByTime(180))
      expect(onChange).toHaveBeenLastCalledWith('Риф')
    } finally {
      vi.useRealTimers()
    }
  })
})
