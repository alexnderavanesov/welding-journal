import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DuplicateControlDialog } from '@/components/duplicate-control-dialog'
import { createEmptyDuplicateControlDraft, DUPLICATE_CONTROL_METHOD_ERROR, type DuplicateControlDraft } from '@/lib/duplicate-control-types'
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
  it.each(['ВИК', 'РК', 'УЗК', 'ПВК'] as const)('blocks %s on a mixed official/unofficial selection and enables it after restoring officiality', method => {
    const rows = [{ id: 1, joint: 'F1' }, { id: 2, joint: 'F2', officiality: 'неофициальный' }] as WeldRow[]
    const onSave = vi.fn()
    const props = { draft: { ...createEmptyDuplicateControlDraft(), rowIds: new Set([1, 2]), methods: new Set([method]), result: 'ремонт' as const },
      filteredRows: rows, selectedRows: rows, controls: [], saveBlockReason: null, isSaving: false,
      onClose: vi.fn(), onSave, onDelete: vi.fn(), onEdit: vi.fn(), onDraftChange: vi.fn(),
      onToggleRow: vi.fn(), onSetVisibleRowsSelected: vi.fn(), onToggleMethod: vi.fn() }
    const { rerender } = render(<DuplicateControlDialog {...props} />)
    for (const result of ['годен', 'ремонт', 'вырез']) expect(screen.getByRole('option', { name: result })).toBeDisabled()
    expect(screen.getByText(/Дубль-контроль недоступен для неофициального стыка/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить дубль' }))
    expect(onSave).not.toHaveBeenCalled()
    rerender(<DuplicateControlDialog {...props} selectedRows={rows.map(row => ({ ...row, officiality: null }))} />)
    expect(screen.getByRole('button', { name: 'Добавить дубль' })).toBeEnabled()
  })
  it.each(['ТВМТ', 'ПСТО'])('blocks a stale %s draft without offering the method', method => {
    const row = { id: 1, joint: 'F1' } as WeldRow
    const onSave = vi.fn()
    render(<DuplicateControlDialog draft={{ ...createEmptyDuplicateControlDraft(), rowIds: new Set([1]), methods: new Set([method]) as DuplicateControlDraft['methods'], result: 'годен' }}
      filteredRows={[row]} selectedRows={[row]} controls={[]} saveBlockReason={null} isSaving={false}
      onClose={vi.fn()} onSave={onSave} onDelete={vi.fn()} onEdit={vi.fn()} onDraftChange={vi.fn()}
      onToggleRow={vi.fn()} onSetVisibleRowsSelected={vi.fn()} onToggleMethod={vi.fn()} />)
    expect(screen.queryByRole('button', { name: method })).not.toBeInTheDocument()
    expect(screen.getByText(DUPLICATE_CONTROL_METHOD_ERROR)).toBeVisible()
    const save = screen.getByRole('button', { name: 'Добавить дубль' })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(onSave).not.toHaveBeenCalled()
  })
  it.each(['ВИК', 'РК', 'УЗК', 'ПВК'] as const)('guards every %s duplicate on an explicitly layered weld', (method) => {
    const row = { id: 1, joint: 'F1', connectionType: 'У17', layeredControlAssigned: true } as WeldRow
    render(<DuplicateControlDialog draft={{ ...createEmptyDuplicateControlDraft(), rowIds: new Set([1]), methods: new Set([method]), result: 'ремонт' }}
      filteredRows={[row]} selectedRows={[row]} controls={[]} saveBlockReason={null} isSaving={false}
      onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onDraftChange={vi.fn()}
      onToggleRow={vi.fn()} onSetVisibleRowsSelected={vi.fn()} onToggleMethod={vi.fn()} />)
    expect(screen.getAllByText('У17').length).toBeGreaterThan(0)
    expect(screen.getByRole('option', { name: 'годен' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'ремонт' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'вырез' })).toBeDisabled()
    expect(screen.getByText(/Любой дубль ВИК\/РК\/УЗК\/ПВК недоступен/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Добавить дубль' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'ТВМТ' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ПСТО' })).not.toBeInTheDocument()
  })
  it('shows a concurrent server rejection without losing the draft or leaving an unhandled promise', async () => {
    const row = { id: 1, joint: 'F1', connectionType: 'У17' } as WeldRow
    const onSave = vi.fn().mockRejectedValueOnce(new Error('При послойном контроле любой дубль недоступен.')).mockResolvedValueOnce(undefined)
    render(<DuplicateControlDialog draft={{ ...createEmptyDuplicateControlDraft(), rowIds: new Set([1]), methods: new Set(['РК']), result: 'годен', conclusion: 'KEEP-DRAFT' }}
      filteredRows={[row]} selectedRows={[row]} controls={[]} saveBlockReason={null} isSaving={false}
      onClose={vi.fn()} onSave={onSave} onDelete={vi.fn()} onEdit={vi.fn()} onDraftChange={vi.fn()}
      onToggleRow={vi.fn()} onSetVisibleRowsSelected={vi.fn()} onToggleMethod={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить дубль' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('При послойном контроле любой дубль недоступен.')
    expect(screen.getByRole('textbox', { name: 'Заключение' })).toHaveValue('KEEP-DRAFT')
    fireEvent.click(screen.getByRole('button', { name: 'Добавить дубль' }))
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
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
