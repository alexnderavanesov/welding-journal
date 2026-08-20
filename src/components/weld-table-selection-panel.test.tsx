import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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
})
