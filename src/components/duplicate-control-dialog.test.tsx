import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DuplicateControlDialog } from '@/components/duplicate-control-dialog'
import { createEmptyDuplicateControlDraft as emptyDraft, DUPLICATE_CONTROL_METHOD_ERROR, type DuplicateControlDraft } from '@/lib/duplicate-control-types'
import type { WeldRow } from '@/lib/dispatcher-types'
import { applyRemoteControlProcessSettings } from '@/lib/control-process-settings'

const createEmptyDuplicateControlDraft = () => ({ ...emptyDraft(), controlDate: '2026-08-20', conclusionDate: '2026-08-21', conclusion: 'Дубль-1' })

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
  it('coalesces clicks while password/save is pending and allows retry after a failure', async () => {
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_, fail) => { reject = fail })
    const onSave = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined)
    const row = { id: 1, joint: 'F1', d1: 159 } as WeldRow
    render(<DuplicateControlDialog draft={{ ...createEmptyDuplicateControlDraft(), rowIds: new Set([1]), methods: new Set(['ВИК']), result: 'годен' }}
      filteredRows={[row]} selectedRows={[row]} controls={[]} saveBlockReason={null} isSaving={false}
      onClose={vi.fn()} onSave={onSave} onDelete={vi.fn()} onEdit={vi.fn()} onDraftChange={vi.fn()}
      onToggleRow={vi.fn()} onSetVisibleRowsSelected={vi.fn()} onToggleMethod={vi.fn()} />)
    const save = screen.getByRole('button', { name: 'Добавить дубль' })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    await act(async () => reject(new Error('Проверка отказа')))
    expect(screen.getByRole('alert')).toHaveTextContent('Проверка отказа')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Добавить дубль' })))
    expect(onSave).toHaveBeenCalledTimes(2)
  })
  it('allows duplicate PVK repair with own-PVK good-only enabled, but never a cut', () => {
    applyRemoteControlProcessSettings({ pvkGoodOnly: true })
    const row = { id: 1, joint: 'F1', d1: 57 } as WeldRow
    render(<DuplicateControlDialog
      draft={{ ...createEmptyDuplicateControlDraft(), rowIds: new Set([1]), methods: new Set(['ПВК']), result: 'ремонт' }}
      filteredRows={[row]} selectedRows={[row]} controls={[]} saveBlockReason={null} isSaving={false}
      onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onDraftChange={vi.fn()}
      onToggleRow={vi.fn()} onSetVisibleRowsSelected={vi.fn()} onToggleMethod={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'ремонт' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Добавить дубль' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'вырез' })).toBeDisabled()
  })
  it('intersects selected methods and joints, shows every restriction and preserves the draft', () => {
    const rows = [{ id: 1, joint: 'F1', d1: 57 }, { id: 2, joint: 'F2R2', d1: 159 }] as WeldRow[]
    const props = { draft: { ...createEmptyDuplicateControlDraft(), rowIds: new Set([1, 2]), methods: new Set(['ВИК', 'РК'] as const), result: 'ремонт' as const },
      filteredRows: rows, selectedRows: rows, controls: [], saveBlockReason: null, isSaving: false,
      onClose: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onDraftChange: vi.fn(),
      onToggleRow: vi.fn(), onSetVisibleRowsSelected: vi.fn(), onToggleMethod: vi.fn() }
    const { rerender } = render(<DuplicateControlDialog {...props} />)
    expect(screen.getByRole('button', { name: 'ремонт' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.focus(screen.getByRole('group', { name: 'ремонт' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('меньше 89 мм')
    expect(screen.getByRole('tooltip')).toHaveTextContent('два ремонта')
    expect(screen.getByRole('button', { name: 'вырез' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Добавить дубль' })).toBeDisabled()
    expect(props.onDraftChange).not.toHaveBeenCalled()
    rerender(<DuplicateControlDialog {...props} selectedRows={[rows[0]!]} draft={{ ...props.draft, methods: new Set(['ВИК']) }} />)
    expect(screen.getByRole('button', { name: 'ремонт' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Добавить дубль' })).toBeEnabled()
    expect(props.onDraftChange).not.toHaveBeenCalled()
  })
  it.each(['ВИК', 'РК', 'УЗК', 'ПВК'] as const)('blocks %s on a mixed official/unofficial selection and enables it after restoring officiality', method => {
    const rows = [{ id: 1, joint: 'F1', d1: 89 }, { id: 2, joint: 'F2', d1: 89, officiality: 'неофициальный' }] as WeldRow[]
    const onSave = vi.fn()
    const props = { draft: { ...createEmptyDuplicateControlDraft(), rowIds: new Set([1, 2]), methods: new Set([method]), result: 'ремонт' as const },
      filteredRows: rows, selectedRows: rows, controls: [], saveBlockReason: null, isSaving: false,
      onClose: vi.fn(), onSave, onDelete: vi.fn(), onEdit: vi.fn(), onDraftChange: vi.fn(),
      onToggleRow: vi.fn(), onSetVisibleRowsSelected: vi.fn(), onToggleMethod: vi.fn() }
    const { rerender } = render(<DuplicateControlDialog {...props} />)
    for (const result of ['годен', 'ремонт', 'вырез']) expect(screen.getByRole('button', { name: result })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'годен' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ремонт' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'вырез' })).toBeDisabled()
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
    window.localStorage.clear()
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
