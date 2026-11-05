import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import type { WeldRow } from '@/lib/dispatcher-types'
import { PROGRAM_EDITOR_METHODS, type ProgramMethod } from '@/lib/line-program-workspace'
import { ProgramAssignmentTable, type ProgramAssignmentTableProps } from './line-program-assignment-table'

const harness = vi.hoisted(() => ({ api: null as unknown as GridApi<WeldRow> }))
vi.mock('./line-program-grid', async () => {
  const { createElement, useEffect } = await import('react')
  const { ProgramGrid } = await import('@/test/program-grid-mock')
  return { ProgramGrid: function ReadyProgramGrid(props: Parameters<typeof ProgramGrid<WeldRow>>[0]) {
    useEffect(() => { props.onReady?.(harness.api) }, [props.onReady])
    return createElement(ProgramGrid<WeldRow>, props)
  } }
})

const first: WeldRow = { id: 1, joint: 'F1', connectionType: 'У19', hasVik: 'да', hasRk: 'да' }
const second: WeldRow = { id: 2, joint: 'F2', connectionType: 'У19', hasVik: 'да' }
const rows = [first, second]
const nodes = rows.map(data => ({ id: String(data.id), data }))
let filters: Map<ProgramMethod, { refreshFilterValues: ReturnType<typeof vi.fn> }>
let props: ProgramAssignmentTableProps

beforeEach(() => {
  filters = new Map(PROGRAM_EDITOR_METHODS.map(method => [method, { refreshFilterValues: vi.fn() }]))
  harness.api = {
    isDestroyed: () => false, refreshCells: vi.fn(), onFilterChanged: vi.fn(),
    getRowNode: vi.fn((id: string) => nodes.find(node => node.id === id)),
    getColumnFilterHandler: vi.fn((method: ProgramMethod) => filters.get(method)),
    isAnyFilterPresent: vi.fn(() => false), getColumnState: vi.fn(() => []),
    ensureNodeVisible: vi.fn(), setFilterModel: vi.fn(),
  } as unknown as GridApi<WeldRow>
  props = { rows, selected: new Set(), draft: new Map(), busy: false, canSelect: () => true,
    onSelect: vi.fn(), onSelectAll: vi.fn(), onChange: vi.fn(), getError: vi.fn(() => '') }
})
afterEach(cleanup)
const clearWork = () => {
  vi.mocked(harness.api.refreshCells).mockClear()
  vi.mocked(harness.api.onFilterChanged).mockClear()
  vi.mocked(props.getError).mockClear()
  for (const filter of filters.values()) filter.refreshFilterValues.mockClear()
}

describe('assignment table independent updates', () => {
  it('selects a row without recalculating assignment options or refreshing the grid', () => {
    const view = render(<ProgramAssignmentTable {...props} />)
    expect(props.getError).toHaveBeenCalled()
    clearWork()
    view.rerender(<ProgramAssignmentTable {...props} selected={new Set([first.id])} />)
    expect(screen.getByRole('checkbox', { name: 'Выбрать F1' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Выбрать F2' })).not.toBeChecked()
    expect(props.getError).not.toHaveBeenCalled()
    expect(harness.api.refreshCells).not.toHaveBeenCalled()
    expect(harness.api.onFilterChanged).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: 'F1 · РК' }), { target: { value: 'дополнительный' } })
    expect(props.onChange).toHaveBeenCalledWith(first, 'РК', 'дополнительный')
  })

  it('refreshes edited assignment values while keeping line-wide hints current in another row', () => {
    const view = render(<ProgramAssignmentTable {...props} />)
    clearWork()
    const draft = new Map([[first.id, { ...first, hasRk: 'дополнительный' }]])
    const removalHints = new Map([[second.id, new Map<ProgramMethod, string>([['ПВК', 'Пересчитанный кандидат другой строки']])]])
    view.rerender(<ProgramAssignmentTable {...props} draft={draft} removalHints={removalHints} />)
    expect(screen.getByRole('combobox', { name: 'F1 · РК' })).toHaveValue('дополнительный')
    expect(screen.getByText('было: да')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'F2 · ПВК' })).toHaveAttribute('title', 'Пересчитанный кандидат другой строки')
    expect(harness.api.refreshCells).toHaveBeenCalledExactlyOnceWith({ columns: PROGRAM_EDITOR_METHODS, rowNodes: [nodes[0]], force: true })
    expect(filters.get('РК')!.refreshFilterValues).toHaveBeenCalledOnce()
    for (const method of PROGRAM_EDITOR_METHODS.filter(method => method !== 'РК')) expect(filters.get(method)!.refreshFilterValues).not.toHaveBeenCalled()
    expect(harness.api.onFilterChanged).not.toHaveBeenCalled()
    clearWork()
    view.rerender(<ProgramAssignmentTable {...props} />)
    expect(screen.getByRole('combobox', { name: 'F1 · РК' })).toHaveValue('да')
    expect(screen.queryByText(/^было:/)).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'F2 · ПВК' })).not.toHaveAttribute('data-removal-candidate')
    expect(harness.api.refreshCells).toHaveBeenCalledExactlyOnceWith({ columns: PROGRAM_EDITOR_METHODS, rowNodes: [nodes[0]], force: true })
  })

  it.each(['filter', 'sort'] as const)('reapplies the %s when a draft changes assignment values', reason => {
    const view = render(<ProgramAssignmentTable {...props} />)
    clearWork()
    if (reason === 'filter') vi.mocked(harness.api.isAnyFilterPresent).mockReturnValue(true)
    else vi.mocked(harness.api.getColumnState).mockReturnValue([{ colId: 'РК', sort: 'desc' }])
    view.rerender(<ProgramAssignmentTable {...props} draft={new Map([[first.id, { ...first, hasRk: 'отменен' }]])} />)
    expect(harness.api.onFilterChanged).toHaveBeenCalledOnce()
  })

  it('updates linked PVK fields and resynchronizes fresh server rows', () => {
    const view = render(<ProgramAssignmentTable {...props} />)
    clearWork()
    view.rerender(<ProgramAssignmentTable {...props} draft={new Map([[first.id, { ...first, layeredControlAssigned: true, hasPvk: 'да' }]])} />)
    expect(screen.getByRole('combobox', { name: 'F1 · ПВК' })).toHaveValue('да')
    expect(screen.getByRole('combobox', { name: 'F1 · Послойный ПВК' })).toHaveValue('да')
    expect(filters.get('ПВК')!.refreshFilterValues).toHaveBeenCalledOnce()
    expect(filters.get('Послойный ПВК')!.refreshFilterValues).toHaveBeenCalledOnce()
    clearWork()
    const saved = { ...first, hasPvk: 'да', layeredControlAssigned: true }
    view.rerender(<ProgramAssignmentTable {...props} rows={[saved, second]} />)
    expect(screen.getByRole('combobox', { name: 'F1 · Послойный ПВК' })).toHaveValue('да')
    expect(harness.api.refreshCells).toHaveBeenCalledExactlyOnceWith({ force: true })
    expect(harness.api.onFilterChanged).toHaveBeenCalledOnce()
  })

  it('refreshes every renderer for fresh metadata even when joint and result values are unchanged', () => {
    const original = { ...first, weldDate: '2026-09-01', vikResult: 'годен', vikRequest: 'REQUEST-OLD' }
    const view = render(<ProgramAssignmentTable {...props} rows={[original, second]} />)
    clearWork()
    const fresh = { ...original, weldDate: '2026-09-02', vikRequest: 'REQUEST-NEW' }
    view.rerender(<ProgramAssignmentTable {...props} rows={[fresh, second]} />)
    // The mock cannot prove AG Grid's renderer lifecycle. The browser test
    // covers unchanged cell values with actual immutable row updates.
    expect(harness.api.refreshCells).toHaveBeenCalledExactlyOnceWith({ force: true })
    for (const method of PROGRAM_EDITOR_METHODS) expect(filters.get(method)!.refreshFilterValues).toHaveBeenCalledOnce()
    expect(harness.api.onFilterChanged).toHaveBeenCalledOnce()
  })

  it('keeps busy state, changed validation, approval and the latest action callback live', () => {
    const view = render(<ProgramAssignmentTable {...props} />)
    const latestChange = vi.fn()
    const getError = vi.fn((_row: WeldRow, method: ProgramMethod, value: string) => method === 'ПВК' && value === 'да' ? 'История не допускает изменение' : '')
    view.rerender(<ProgramAssignmentTable {...props} getError={getError} onChange={latestChange} busy />)
    expect(screen.getByRole('checkbox', { name: 'Выбрать F1' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'F1 · ПВК' })).toBeDisabled()
    expect(within(screen.getByRole('combobox', { name: 'F1 · ПВК' })).getByRole('option', { name: 'Да' })).toBeDisabled()
    expect(screen.queryByText('✓ Согласовано')).not.toBeInTheDocument()
    view.rerender(<ProgramAssignmentTable {...props} getError={getError} onChange={latestChange} canSelect={row => row.id !== first.id} />)
    expect(screen.getByRole('checkbox', { name: 'Выбрать F1' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Выбрать F2' })).toBeEnabled()
    expect(screen.queryByText('✓ Согласовано')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'F1 · РК' }), { target: { value: 'отменен' } })
    expect(latestChange).toHaveBeenCalledWith(first, 'РК', 'отменен')
    expect(props.onChange).not.toHaveBeenCalled()
  })
})
