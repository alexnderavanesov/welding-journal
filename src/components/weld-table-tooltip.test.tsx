import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WeldTable } from '@/components/weld-table'
import type { WeldRow } from '@/lib/dispatcher-types'
import { VISIBLE_FIELDS, type WeldFieldKey } from '@/lib/weld-fields'

describe('WeldTable delegated tooltips', () => {
  it('creates a cell tooltip only when the cell is hovered', () => {
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
        />
      </QueryClientProvider>,
    )
    const cell = container.querySelector<HTMLTableCellElement>('td[data-weld-field-key="line"]')

    expect(cell).not.toBeNull()
    expect(cell).not.toHaveAttribute('title')
    fireEvent.mouseOver(cell as HTMLTableCellElement)
    expect(cell).toHaveAttribute('title', expect.stringContaining('330-P1'))
    expect(cell).toHaveAttribute('title', expect.stringContaining('Данные сварочного журнала'))
    fireEvent.mouseOut(cell as HTMLTableCellElement)
    expect(cell).not.toHaveAttribute('title')
  })
})
