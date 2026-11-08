import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ClipboardEvent } from 'react'
import type { GridApi } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import type { JournalRangeRequest } from './journal-server-grid'
import { useJournalInlineEdit } from './use-journal-inline-edit'
import { pasteJournalCells, saveJournalCellEdits } from '@/server/journal-inline-edit-api'

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@/server/journal-inline-edit-api', () => ({ pasteJournalCells: vi.fn(), saveJournalCellEdits: vi.fn() }))
vi.mock('./weld-query-utils', () => ({ scheduleWeldDataRefresh: vi.fn() }))
beforeEach(() => { vi.clearAllMocks(); vi.mocked(pasteJournalCells).mockResolvedValue({ count: 1 }) })

function setup(availability: 'ready' | 'updating' | 'expired' | 'load-error' = 'ready') {
  const column = { getColId: () => 'weldingJournalNote' }
  const api = { isDestroyed: () => false, getCellRanges: () => [], getFocusedCell: () => ({ rowIndex: 0, column }),
    getAllDisplayedColumns: () => [column], getDisplayedRowCount: () => 1 } as unknown as GridApi<WeldRow>
  const range = { parts: [{ route: [], start: 0, end: 1, columns: ['weldingJournalNote'] }], groupBy: [] } as unknown as JournalRangeRequest
  const props = { api, availability, enabled: true, canEditCell: () => true, canEditField: () => true,
    getEditRange: () => range, onError: vi.fn() }
  const view = renderHook(options => useJournalInlineEdit(options), { initialProps: props })
  const run = (operation: 'paste' | 'clear') => act(() => {
    if (operation === 'clear') view.result.current.clear()
    else view.result.current.paste({ target: document.createElement('div'), preventDefault: vi.fn(), stopPropagation: vi.fn(),
      clipboardData: { getData: () => 'New note' } } as unknown as ClipboardEvent<HTMLElement>)
  })
  return { ...view, props, run }
}

for (const operation of ['paste', 'clear'] as const) {
  const label = operation === 'clear' ? 'Очистка ячеек' : 'Вставка в ячейки'
  const retry = operation === 'clear' ? 'очистку' : 'вставку'
  it.each(['updating', 'expired', 'load-error'] as const)(`${operation}: explains %s without writing or queuing a retry`, async availability => {
    const view = setup(availability)
    view.run(operation)
    expect(view.props.onError).toHaveBeenLastCalledWith(expect.stringContaining(`${label} не выполнена`))
    expect(view.result.current.status.details).toContain(availability === 'expired' ? 'Нажмите «Обновить таблицу»'
      : availability === 'load-error' ? 'Нажмите «Повторить загрузку»' : 'журнал ещё обновляется')
    expect(view.result.current.status.details).toContain(`повторите ${retry}`)
    expect(pasteJournalCells).not.toHaveBeenCalled()
    expect(saveJournalCellEdits).not.toHaveBeenCalled()
    expect(view.result.current.canEdit({ id: 1 } as WeldRow, 'weldingJournalNote')).toBe(false)
    view.rerender({ ...view.props, availability: 'ready' })
    expect(pasteJournalCells).not.toHaveBeenCalled()
    expect(view.result.current.canEdit({ id: 1 } as WeldRow, 'weldingJournalNote')).toBe(true)
    await act(async () => view.run(operation))
    expect(pasteJournalCells).toHaveBeenCalledExactlyOnceWith({ data: { range: expect.anything(), values: [[operation === 'clear' ? '' : 'New note']] } })
    view.unmount()
  })

  it(`${operation}: names the pending save, blocks the second action and never replays it`, async () => {
    let finish!: (result: { count: number }) => void
    vi.mocked(pasteJournalCells).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = setup()
    view.run('paste')
    view.rerender({ ...view.props, availability: 'updating' })
    view.run(operation)
    expect(view.result.current.status.details).toContain(`${label} не выполнена: предыдущее изменение ещё сохраняется`)
    expect(view.result.current.status.details).toContain(`повторите ${retry}`)
    expect(pasteJournalCells).toHaveBeenCalledTimes(1)
    await act(async () => finish({ count: 1 }))
    view.rerender({ ...view.props, availability: 'ready' })
    expect(pasteJournalCells).toHaveBeenCalledTimes(1)
    view.unmount()
  })
}
