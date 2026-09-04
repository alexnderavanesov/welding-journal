import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WeldTable } from '@/components/weld-table'
import type { WeldRow } from '@/lib/dispatcher-types'
import { VISIBLE_FIELDS, type WeldFieldKey } from '@/lib/weld-fields'

describe('WeldTable selection panel', () => {
  it('keeps selected-row actions in a neutral panel at the lower-left edge', () => {
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
          selectable
          selectedRowIds={new Set([1])}
          onSelectedRowIdsChange={vi.fn()}
          stickyLeft={40}
          hiddenFieldKeys={hiddenFieldKeys}
        />
      </QueryClientProvider>,
    )

    const panel = screen.getByLabelText('Действия с выбранными стыками')

    expect(panel).toHaveClass('bottom-2', 'border-slate-200', 'bg-white/95', 'shadow-slate-900/10')
    expect(panel).not.toHaveClass('border-sky-200', 'bg-sky-50/95', 'shadow-sky-200/70')
    expect(panel).toHaveStyle({ left: '44px' })
    expect(panel.parentElement).not.toHaveClass('w-max')
    expect(panel.parentElement?.style.width).toMatch(/^\d+(\.\d+)?px$/)
    expect(document.querySelector('[data-selection-panel-clearance]')).toHaveClass('h-12')
  })

  it('keeps the selected-row menu open when a pending page scroll arrives', () => {
    const rows = [
      { id: 1, line: 'Lin123', joint: 'S1' },
      { id: 2, line: 'LIN123', joint: 'S2' },
    ] as WeldRow[]
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <WeldTable
          rows={rows}
          columnFilters={{}}
          onColumnFiltersChange={vi.fn()}
          selectable
          selectedRowIds={new Set([1, 2])}
          onSelectedRowIdsChange={vi.fn()}
          getContextMenuItems={(_row, selectedRows) => [{
            id: 'delete-selected',
            label: `Удалить выбранные (${selectedRows.length})`,
            onSelect: vi.fn(),
          }]}
        />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Действия' }))
    fireEvent.scroll(window)

    expect(screen.getByRole('button', { name: 'Удалить выбранные (2)' })).toBeVisible()
  })
})
