import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WeldTable } from '@/components/weld-table'
import { getWeldFilterMenuPosition } from '@/components/weld-table-field-header-rows'
import type { WeldRow } from '@/lib/dispatcher-types'
import { VISIBLE_FIELDS, type WeldFieldKey } from '@/lib/weld-fields'

describe('WeldTable header layout', () => {
  it('keeps a wide filter menu inside both viewport edges', () => {
    expect(getWeldFilterMenuPosition({ anchorLeft: 8, anchorBottom: 120, viewportWidth: 1200 })).toEqual({
      left: 16,
      top: 116,
    })
    expect(getWeldFilterMenuPosition({ anchorLeft: 1100, anchorBottom: 120, viewportWidth: 1200 })).toEqual({
      left: 800,
      top: 116,
    })
    expect(getWeldFilterMenuPosition({ anchorLeft: 300, anchorBottom: 80, viewportWidth: 320 })).toEqual({
      left: 16,
      top: 76,
    })
  })

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

    fireEvent.click(filterButton)
    const filterMenu = screen.getByText('Фильтр по значениям').closest('.fixed')
    expect(filterMenu).toHaveClass('fixed')
    expect(filterMenu?.parentElement).toBe(document.body)
  })

  it('keeps task panels and the table on one right edge with a visible gutter', () => {
    const hiddenFieldKeys = new Set(
      VISIBLE_FIELDS
        .map((field) => field.key as WeldFieldKey)
        .filter((fieldKey) => fieldKey !== 'line'),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <WeldTable
          rows={[{ id: 1, line: '330-P1' } as WeldRow]}
          columnFilters={{}}
          onColumnFiltersChange={vi.fn()}
          readOnly
          hiddenFieldKeys={hiddenFieldKeys}
          reportTaskPanels={<div data-testid="report-task-panels">Диспетчер</div>}
        />
      </QueryClientProvider>,
    )

    const layout = container.querySelector<HTMLElement>('[data-report-table-layout]')
    const taskPanelsFrame = container.querySelector<HTMLElement>('[data-report-task-panels-frame]')
    const tableFrame = container.querySelector<HTMLElement>('[data-report-table-frame]')

    expect(taskPanelsFrame?.style.width).toBe(tableFrame?.style.width)
    expect(Number.parseFloat(layout?.style.width ?? '0')).toBe(
      Number.parseFloat(tableFrame?.style.width ?? '0') + 12,
    )
  })
})
