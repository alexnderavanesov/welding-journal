import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

  it('keeps the same table body while filters settle but disables row and selection actions immediately', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const rows = [{ id: 1, line: 'L1', joint: 'S1' }] as WeldRow[]
    const onSelectedRowIdsChange = vi.fn()
    const onSelect = vi.fn()
    const table = (rowsReady: boolean, queryIdentity: string) => (
      <QueryClientProvider client={queryClient}>
        <WeldTable rows={rows} rowsReady={rowsReady} queryIdentity={queryIdentity}
          columnFilters={{ line: 'L1' }} onColumnFiltersChange={vi.fn()}
          selectable selectedRowIds={new Set([1])} onSelectedRowIdsChange={onSelectedRowIdsChange}
          getContextMenuItems={() => [{ id: 'delete', label: 'Удалить текущий набор', onSelect }]} />
      </QueryClientProvider>
    )
    const { container, rerender } = render(table(true, 'A'))
    const body = container.querySelector('tbody')!
    const row = body.querySelector('tr[data-weld-row-id="1"]')!
    fireEvent.click(screen.getByRole('button', { name: 'Действия' }))
    expect(screen.getByRole('button', { name: 'Удалить текущий набор' })).toBeVisible()

    rerender(table(false, 'B'))
    expect(container.querySelector('tbody')).toBe(body)
    expect(body.querySelector('tr[data-weld-row-id="1"]')).toBe(row)
    expect(body).toHaveAttribute('inert')
    expect(body).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: 'Удалить текущий набор' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Действия' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Выбрать видимые стыки' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сбросить все фильтры' })).toBeEnabled()
    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByRole('button', { name: 'Действия' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(onSelectedRowIdsChange).not.toHaveBeenCalled()

    rerender(table(true, 'B'))
    expect(body).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Действия' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Удалить текущий набор' })).not.toBeInTheDocument()
  })

  it('never silently replaces an explicit selection with only its loaded subset', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const rows = [{ id: 1, line: 'L1', joint: 'S1' }] as WeldRow[]
    const getContextMenuItems = vi.fn((_row: WeldRow, selectedRows: WeldRow[]) => [{
      id: 'selected', label: `Обработать ${selectedRows.length}`, onSelect: vi.fn(),
    }])
    const table = (actionRows: WeldRow[]) => (
      <QueryClientProvider client={queryClient}>
        <WeldTable rows={rows} actionRows={actionRows} columnFilters={{}} onColumnFiltersChange={vi.fn()}
          selectable selectedRowIds={new Set([1, 2])} onSelectedRowIdsChange={vi.fn()}
          getContextMenuItems={getContextMenuItems} />
      </QueryClientProvider>
    )
    const { container, rerender } = render(table(rows))
    expect(screen.getByText('Выбрано: 2')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Действия' })).toBeDisabled()
    fireEvent.contextMenu(container.querySelector('tr[data-weld-row-id="1"]')!)
    expect(getContextMenuItems).not.toHaveBeenCalled()
    rerender(table([...rows, { id: 2, line: 'L2', joint: 'S2' } as WeldRow]))
    fireEvent.click(screen.getByRole('button', { name: 'Действия' }))
    expect(screen.getByRole('button', { name: 'Обработать 2' })).toBeVisible()
    expect(getContextMenuItems.mock.calls.at(-1)?.[1].map(row => row.id)).toEqual([1, 2])
  })

  it.each(['lnk', 'heatTreatment'])('%s row and selection menus load exactly the offpage selection and consume Escape without clearing it', async storageKey => {
    const rows: WeldRow[] = [{ id: 1, line: 'L1', joint: 'F1', rowVersion: 'v1' }, { id: 2, line: 'L2', joint: 'F2', rowVersion: 'v2' }]
    let resolve!: (rows: WeldRow[]) => void
    const pending = new Promise<WeldRow[]>(yes => { resolve = yes })
    const load = vi.fn(() => pending), onError = vi.fn(), onSelection = vi.fn(), onAction = vi.fn()
    const getItems = vi.fn((_row: WeldRow, selected: WeldRow[]) => [{ id: 'selected', label: `Обработать ${selected.length}`, onSelect: () => onAction(selected) }])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(<QueryClientProvider client={queryClient}><WeldTable
      storageKey={storageKey} rows={rows.slice(0, 1)} columnFilters={{}} onColumnFiltersChange={vi.fn()}
      selectable selectedRowIds={new Set([1, 2])} onSelectedRowIdsChange={onSelection}
      getContextMenuItems={getItems} loadContextMenuRows={load} onContextMenuError={onError}
    /></QueryClientProvider>)
    expect(load).not.toHaveBeenCalled()
    fireEvent.contextMenu(container.querySelector('tr[data-weld-row-id="1"]')!)
    expect(screen.getByText('Загружаем выбранные стыки…')).toBeVisible()
    expect(getItems).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledExactlyOnceWith([1, 2])
    const escaped = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    fireEvent(window, escaped)
    expect(escaped.defaultPrevented).toBe(true)
    await act(async () => { resolve(rows); await pending })
    expect(screen.queryByTestId('context-action-menu')).not.toBeInTheDocument()
    expect(onSelection).not.toHaveBeenCalled()
    load.mockResolvedValueOnce([...rows].reverse())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Действия' })) })
    expect(load).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Обработать 2' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith(rows)
    expect(onError).not.toHaveBeenCalled()
    expect(onSelection).not.toHaveBeenCalled()
  })
})
