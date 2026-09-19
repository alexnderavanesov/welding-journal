import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WeldTable } from '@/components/weld-table'
import type { WeldRow } from '@/lib/dispatcher-types'
import { VISIBLE_FIELDS, type WeldFieldKey } from '@/lib/weld-fields'

describe('WeldTable context menu row', () => {
  it('uses current visible document data when the action row is stale', () => {
    const displayRow = {
      id: 1,
      line: '330-MS-02-000',
      joint: 'S63W1R1',
      vikRequest: 'Заявка НК №73281024/4152-330-TKM5-056',
      vikRequestDate: '2026-09-01',
      systemDocumentIds: { vikRequest: 77 },
    } as WeldRow
    const staleActionRow = {
      id: 1,
      line: displayRow.line,
      joint: displayRow.joint,
    } as WeldRow
    const getContextMenuItems = vi.fn((
      _row: WeldRow,
      _selectedRows: WeldRow[],
      _fieldKey?: WeldFieldKey,
    ) => [{
      id: 'open-document',
      label: 'Открыть в документах',
      onSelect: vi.fn(),
    }])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const hiddenFieldKeys = new Set(
      VISIBLE_FIELDS
        .map((field) => field.key as WeldFieldKey)
        .filter((fieldKey) => fieldKey !== 'vikRequest'),
    )

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <WeldTable
          rows={[displayRow]}
          actionRows={[staleActionRow]}
          columnFilters={{}}
          onColumnFiltersChange={vi.fn()}
          getContextMenuItems={getContextMenuItems}
          hiddenFieldKeys={hiddenFieldKeys}
        />
      </QueryClientProvider>,
    )

    const documentCell = container.querySelector<HTMLElement>('[data-weld-field-key="vikRequest"]')
    expect(documentCell).not.toBeNull()
    fireEvent.contextMenu(documentCell!)

    expect(getContextMenuItems).toHaveBeenCalledTimes(1)
    const [contextRow, selectedRows, fieldKey] = getContextMenuItems.mock.calls[0]
    expect(fieldKey).toBe('vikRequest')
    expect(contextRow).toMatchObject({
      vikRequest: displayRow.vikRequest,
      vikRequestDate: displayRow.vikRequestDate,
      systemDocumentIds: { vikRequest: 77 },
    })
    expect(selectedRows).toEqual([contextRow])
  })

  it('uses current visible rows for grouped actions when action rows are stale', () => {
    const displayRows = [{
      id: 1,
      line: 'NEW-LINE',
      joint: 'F1',
    }, {
      id: 2,
      line: 'NEW-LINE',
      joint: 'F2',
    }] as WeldRow[]
    const staleActionRows = displayRows.map((row) => ({
      ...row,
      line: 'OLD-LINE',
    })) as WeldRow[]
    const getContextMenuItems = vi.fn(() => [{
      id: 'group-action',
      label: 'Групповое действие',
      onSelect: vi.fn(),
    }])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <WeldTable
          rows={displayRows}
          actionRows={staleActionRows}
          columnFilters={{}}
          onColumnFiltersChange={vi.fn()}
          getContextMenuItems={getContextMenuItems}
          selectable
          selectedRowIds={new Set([1, 2])}
          onSelectedRowIdsChange={vi.fn()}
        />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Действия' }))

    expect(getContextMenuItems).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, line: 'NEW-LINE' }),
      [
        expect.objectContaining({ id: 1, line: 'NEW-LINE' }),
        expect.objectContaining({ id: 2, line: 'NEW-LINE' }),
      ],
    )
  })
})
