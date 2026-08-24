import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WeldTable } from '@/components/weld-table'
import type { WeldRow } from '@/lib/dispatcher-types'
import { VISIBLE_FIELDS, type WeldFieldKey } from '@/lib/weld-fields'

describe('WeldTable header layout', () => {
  it('keeps the field header row fixed and clamps long labels', () => {
    const hiddenFieldKeys = new Set(
      VISIBLE_FIELDS
        .map((field) => field.key as WeldFieldKey)
        .filter((fieldKey) => fieldKey !== 'line'),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <WeldTable
          rows={[{ id: 1, line: '330-P1' } as WeldRow]}
          columnFilters={{}}
          onColumnFiltersChange={vi.fn()}
          readOnly
          hiddenFieldKeys={hiddenFieldKeys}
        />
      </QueryClientProvider>,
    )

    const filterButton = screen.getByRole('button', { name: 'Линия. Открыть фильтр' })
    const label = filterButton.querySelector('span')

    expect(filterButton.closest('tr')).toHaveClass('h-16')
    expect(filterButton).toHaveClass('h-10', 'overflow-hidden')
    expect(filterButton).toHaveAttribute('title', 'Линия. Фильтр по значениям')
    expect(label).toHaveClass('line-clamp-2')
  })
})
