import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { WeldTable } from '@/components/weld-table'
import { getWeldFilterMenuPosition } from '@/components/weld-table-field-header-rows'
import type { WeldRow } from '@/lib/dispatcher-types'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'
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

  it('keeps searched selections visible after reopening and closes the filter with Escape', () => {
    const hiddenFieldKeys = new Set(
      VISIBLE_FIELDS
        .map((field) => field.key as WeldFieldKey)
        .filter((fieldKey) => fieldKey !== 'line'),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const rows = [
      { id: 1, line: '330-А-01' },
      { id: 2, line: '330-А-02' },
      { id: 3, line: '0104-1' },
    ] as WeldRow[]

    function FilterHarness() {
      const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
      return (
        <>
          <span data-testid="weld-filter-value">{columnFilters.line ?? ''}</span>
          <WeldTable
            rows={rows}
            columnFilters={columnFilters}
            onColumnFiltersChange={setColumnFilters}
            readOnly
            hiddenFieldKeys={hiddenFieldKeys}
          />
        </>
      )
    }

    render(
      <QueryClientProvider client={queryClient}>
        <FilterHarness />
      </QueryClientProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Линия. Открыть фильтр' })
    fireEvent.click(trigger)
    fireEvent.change(screen.getByPlaceholderText('Найти значение'), { target: { value: '330-а' } })
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }))

    expect(parseWeldColumnChoiceFilter(screen.getByTestId('weld-filter-value').textContent ?? ''))
      .toEqual({ kind: 'values', values: ['330-А-01', '330-А-02'] })

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Фильтр: Линия' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByPlaceholderText('Найти значение')).toHaveValue('330-а')
    expect(screen.getByRole('button', { name: /330-А-01/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /330-А-02/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /0104-1/ })).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByPlaceholderText('Найти значение'), { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Фильтр: Линия' })).not.toBeInTheDocument()
    expect(parseWeldColumnChoiceFilter(screen.getByTestId('weld-filter-value').textContent ?? ''))
      .toEqual({ kind: 'values', values: ['330-А-01', '330-А-02'] })
  })

  it('leaves Escape to a modal opened above the column filter', () => {
    const hiddenFieldKeys = new Set(
      VISIBLE_FIELDS
        .map((field) => field.key as WeldFieldKey)
        .filter((fieldKey) => fieldKey !== 'line'),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <WeldTable
          rows={[{ id: 1, line: '330-А-01' } as WeldRow]}
          columnFilters={{}}
          onColumnFiltersChange={vi.fn()}
          readOnly
          hiddenFieldKeys={hiddenFieldKeys}
        />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Линия. Открыть фильтр' }))
    const modalMarker = document.createElement('div')
    modalMarker.dataset.modalDialog = 'true'
    document.body.append(modalMarker)

    try {
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.getByRole('dialog', { name: 'Фильтр: Линия' })).toBeInTheDocument()
    } finally {
      modalMarker.remove()
    }
  })

  it('keeps task panels and the table on one inset right edge without a synthetic border', () => {
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
    const tableBorderFrame = tableFrame?.querySelector<HTMLElement>(':scope > .relative')

    expect(taskPanelsFrame?.style.width).toBe(tableFrame?.style.width)
    expect(Number.parseFloat(layout?.style.width ?? '0')).toBe(
      Number.parseFloat(tableFrame?.style.width ?? '0') + 24,
    )
    expect(tableBorderFrame).toHaveClass('after:right-0', 'after:bg-[#dbe7f0]')
    expect(tableBorderFrame).not.toHaveClass('overflow-hidden')
    expect(container.querySelector('[data-report-visible-right-edge]')).toBeNull()
    expect(container.querySelector('[data-report-horizontal-scrollbar]')).toBeNull()
  })

  it('continues header and row separators through the sticky left cover', () => {
    const hiddenFieldKeys = new Set(
      VISIBLE_FIELDS
        .map((field) => field.key as WeldFieldKey)
        .filter((fieldKey) => fieldKey !== 'line'),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <WeldTable
          rows={[{ id: 1, line: '330-P1', joint: 'S1' } as WeldRow]}
          columnFilters={{}}
          onColumnFiltersChange={vi.fn()}
          readOnly
          selectable
          stickyIdentityColumns
          stickyLeft={80}
          hiddenFieldKeys={hiddenFieldKeys}
        />
      </QueryClientProvider>,
    )

    const stickyHeader = container.querySelector('th.sticky')
    const stickyRowCell = container.querySelector('tbody td.sticky')

    expect(stickyHeader).toHaveClass(
      'border-l-2',
      'before:border-y-2',
      'before:top-[-2px]',
      'before:bottom-[-2px]',
    )
    expect(stickyRowCell).toHaveClass(
      'border-l',
      'before:border-b',
      'before:top-0',
      'before:bottom-[-1px]',
    )
  })
})
