import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DuplicateControlDialog } from '@/components/duplicate-control-dialog'
import { createEmptyDuplicateControlDraft } from '@/lib/duplicate-control-types'
import type { WeldRow } from '@/lib/dispatcher-types'

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]

  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
}

describe('DuplicateControlDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a bounded row batch without changing actions for the complete filtered set', () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      joint: `F${index + 1}`,
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
    })) as WeldRow[]
    const onSetVisibleRowsSelected = vi.fn()
    const onToggleMethod = vi.fn()

    render(
      <DuplicateControlDialog
        draft={createEmptyDuplicateControlDraft()}
        filteredRows={rows}
        selectedRows={[]}
        controls={[]}
        saveBlockReason="Выберите один или несколько стыков."
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onDraftChange={vi.fn()}
        onToggleRow={vi.fn()}
        onSetVisibleRowsSelected={onSetVisibleRowsSelected}
        onToggleMethod={onToggleMethod}
      />,
    )

    expect(screen.getByText('F1')).toBeInTheDocument()
    expect(screen.queryByText('F100')).not.toBeInTheDocument()
    expect(screen.queryByText('F101')).not.toBeInTheDocument()
    expect(screen.getAllByText(/^F\d+$/)).toHaveLength(12)
    expect(screen.getByText(/1-100/)).toBeInTheDocument()
    expect(screen.getByText(/из 120 строк/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ВИК' }))
    expect(onToggleMethod).toHaveBeenCalledWith('ВИК')

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать найденные' }))
    expect(onSetVisibleRowsSelected).toHaveBeenCalledWith(true)
  })

  it('shows server totals without requiring every matching row in browser memory', () => {
    const rows = [{
      id: 1,
      joint: 'F1',
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
    }] as WeldRow[]
    const onExistingControlsOpenChange = vi.fn()

    render(
      <DuplicateControlDialog
        draft={createEmptyDuplicateControlDraft()}
        filteredRows={rows}
        filteredRowCount={200_000}
        candidatePagination={{
          totalCount: 200_000,
          firstItemNumber: 1,
          lastItemNumber: 1,
          pageSize: 100,
          hasMore: true,
          onLoadMore: vi.fn(),
          onPageSizeChange: vi.fn(),
        }}
        selectedRows={[]}
        controls={[]}
        saveBlockReason="Выберите один или несколько стыков."
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onDraftChange={vi.fn()}
        onToggleRow={vi.fn()}
        onSetVisibleRowsSelected={vi.fn()}
        onToggleMethod={vi.fn()}
        onExistingControlsOpenChange={onExistingControlsOpenChange}
      />,
    )

    expect(screen.getByText(/Найдено: 200000/)).toBeInTheDocument()
    expect(screen.getByText(/из 200000 строк/)).toBeInTheDocument()
    expect(screen.getAllByText('F1')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /Внесенные дубли/ }))
    expect(onExistingControlsOpenChange).toHaveBeenCalledWith(true)
  })
})
