import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomFilterDisplayProps } from 'ag-grid-react'
import { DOCUMENT_HISTORY_SERVER_FILTER, DocumentGridFilterContext, type DocumentGridFilterContextValue } from './document-history-grid-filter'
import { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'

const mocks = vi.hoisted(() => ({ close: vi.fn(), setFocusedHeader: vi.fn() }))
vi.mock('ag-grid-react', () => ({
  useGridFilterDisplay: (callbacks: { afterGuiAttached: (params: { hidePopup: () => void }) => void }) => {
    useEffect(() => { callbacks.afterGuiAttached({ hidePopup: mocks.close }) }, [])
  },
}))
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.clearAllMocks() })

function setup(loadOptions: DocumentGridFilterContextValue['loadOptions'], { field = 'line', initial = '' }: { field?: 'line' | 'date' | 'period' | 'updatedAt'; initial?: string } = {}) {
  const changes = vi.fn(), client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  const Filter = DOCUMENT_HISTORY_SERVER_FILTER.component
  function Test() {
    const [filters, setFilters] = useState<Record<string, string>>(initial ? { [field]: initial } : {})
    return <QueryClientProvider client={client}><DocumentGridFilterContext.Provider value={{ viewId: 'test', search: 'whole registry', columnFilters: filters, sourceRevision: 1, loadOptions,
      change: (key, value) => { changes(key, value); setFilters(current => ({ ...current, [key]: value })) },
    }}><Filter {...({ api: { setFocusedHeader: mocks.setFocusedHeader }, column: { getColId: () => field, getColDef: () => ({ headerName: field === 'line' ? 'Линия' : 'Дата' }) } } as unknown as CustomFilterDisplayProps)} /></DocumentGridFilterContext.Provider></QueryClientProvider>
  }
  render(<Test />)
  return { changes, client }
}

describe('document grid server facets', () => {
  it('retains selected unavailable values, uses full-registry scope and does not refetch its own facet after a checkbox change', async () => {
    const load = vi.fn().mockResolvedValue({ options: [{ value: 'L1', label: 'L1', count: 5 }], hasMore: false })
    const { changes } = setup(load, { initial: buildWeldColumnValueFilter(['L-legacy']) })
    await screen.findByRole('checkbox', { name: /L1/ })
    expect(screen.getByRole('checkbox', { name: /L-legacy/ })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: /L1/ }))
    expect(parseWeldColumnChoiceFilter(changes.mock.lastCall![1])).toMatchObject({ values: ['L-legacy', 'L1'] })
    await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('line', '', 'whole registry')
  })
  it('debounces remote search and selecting shown values never expands to undisplayed server values', async () => {
    const load = vi.fn().mockImplementation((_field, search) => Promise.resolve({ options: search ? [{ value: 'L2', label: 'L2', count: 2 }] : [{ value: 'L1', label: 'L1', count: 5 }], hasMore: Boolean(search) }))
    const { changes } = setup(load)
    await screen.findByRole('checkbox', { name: /L1/ })
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти значение фильтра' }), { target: { value: 'L2' } })
    await screen.findByRole('checkbox', { name: /L2/ })
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать найденные' }))
    expect(parseWeldColumnChoiceFilter(changes.mock.lastCall![1])).toMatchObject({ values: ['L2'] })
    expect(screen.getByText(/Уточните поиск/)).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('groups dates by year/month while keeping exact original filter values', async () => {
    const load = vi.fn().mockResolvedValue({ options: [{ value: '01.10.2026 12:10', label: '01.10.2026 12:10', count: 1 }, { value: '02.10.2026 15:20', label: '02.10.2026 15:20', count: 3 }, { value: '', label: '(пусто)', count: 2 }], hasMore: true })
    const { changes } = setup(load, { field: 'date' })
    await screen.findByRole('checkbox', { name: 'Год 2026' })
    expect(screen.getByText(/Выбор года, месяца или дня включает только значения из этого списка/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Год 2026' }))
    expect(parseWeldColumnChoiceFilter(changes.mock.lastCall![1])?.values.sort()).toEqual(['01.10.2026 12:10', '02.10.2026 15:20'])
    expect(screen.getByRole('checkbox', { name: /пусто/ })).not.toBeChecked()
  })
  it('uses the journal controls and preserves selected values hidden by remote search when toggling a date branch', async () => {
    const period = '01.10.2026 - 07.10.2026'
    const hidden = '01.09.2026 - 08.09.2026'
    const load = vi.fn().mockImplementation((_field, search) => Promise.resolve({ options: search
      ? [{ value: period, label: period, count: 4 }]
      : [{ value: hidden, label: hidden, count: 2 }, { value: period, label: period, count: 4 }], hasMore: false }))
    const { changes } = setup(load, { field: 'period', initial: buildWeldColumnValueFilter([hidden]) })
    await screen.findByRole('checkbox', { name: 'Год 2026' })
    expect(screen.getByRole('dialog')).toHaveClass('journal-filter')
    expect(screen.getByRole('checkbox', { name: 'Год 2026' })).toBePartiallyChecked()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '07.10' } })
    await screen.findByRole('checkbox', { name: /01\.10\.2026 - 07\.10\.2026/ })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Октябрь 2026' }))
    expect(parseWeldColumnChoiceFilter(changes.mock.lastCall![1])?.values).toEqual([hidden, period])
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith('period', '07.10', 'whole registry')
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтр' }))
    expect(changes.mock.lastCall).toEqual(['period', ''])
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByRole('textbox')).toHaveFocus()
  })
  it('keeps an error recoverable and Escape closes only its own popup', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ options: [], hasMore: false })
    setup(load)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить значения')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByText('Значений не найдено')
    const modal = document.createElement('div'); modal.dataset.modalDialog = 'true'; document.body.append(modal)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(mocks.close).not.toHaveBeenCalled()
    modal.remove()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1))
    expect(mocks.setFocusedHeader).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть фильтр' }))
    expect(mocks.close).toHaveBeenCalledTimes(2)
    expect(mocks.setFocusedHeader).toHaveBeenCalledTimes(2)
  })
  it('keeps previous values disabled through rapid searches, ignores a late answer and shows a real error/retry', async () => {
    let resolveA!: (value: { options: Array<{ value: string; label: string; count: number }>; hasMore: boolean }) => void
    let resolveB!: typeof resolveA, rejectNext!: (reason: Error) => void
    const a = new Promise<Parameters<typeof resolveA>[0]>(resolve => { resolveA = resolve })
    const b = new Promise<Parameters<typeof resolveA>[0]>(resolve => { resolveB = resolve })
    const failure = new Promise<Parameters<typeof resolveA>[0]>((_resolve, reject) => { rejectNext = reject })
    const result = (value: string) => ({ options: [{ value, label: value, count: 1 }], hasMore: false })
    const load = vi.fn().mockResolvedValueOnce(result('L0')).mockReturnValueOnce(a).mockReturnValueOnce(b)
      .mockReturnValueOnce(failure).mockResolvedValueOnce(result('Recovered'))
    const { changes } = setup(load)
    const previous = await screen.findByRole('checkbox', { name: /L0/ })
    const search = screen.getByRole('textbox', { name: 'Найти значение фильтра' })
    fireEvent.change(search, { target: { value: 'A' } })
    expect(previous).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Выбрать найденные' })).toBeDisabled()
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('checkbox', { name: /L0/ })).toBe(previous)
    expect(screen.getByRole('status')).toHaveTextContent('Обновляем значения…')
    fireEvent.change(search, { target: { value: 'B' } })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3))
    await act(async () => resolveB(result('B')))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /B/ })).toBeEnabled())
    await act(async () => resolveA(result('A')))
    expect(screen.queryByRole('checkbox', { name: /A/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /B/ })).toBeEnabled()
    expect(changes).not.toHaveBeenCalled()
    fireEvent.change(search, { target: { value: 'Error' } })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(4))
    expect(screen.getByRole('checkbox', { name: /B/ })).toBeDisabled()
    await act(async () => rejectNext(new Error('offline')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить значения')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Recovered/ })).toBeEnabled())
    expect(load).toHaveBeenCalledTimes(5)
  })
  it('disables date-branch controls and selected children while their facet is updating', async () => {
    const load = vi.fn().mockResolvedValueOnce({ options: [{ value: '01.10.2026', label: '01.10.2026', count: 1 }], hasMore: false })
      .mockReturnValueOnce(new Promise(() => {}))
    setup(load, { field: 'date', initial: buildWeldColumnValueFilter(['01.10.2026']) })
    await screen.findByRole('checkbox', { name: 'Год 2026' })
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть Год 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть Октябрь 2026' }))
    const selected = screen.getByRole('checkbox', { name: 'День 01.10.2026' })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2027' } })
    expect(selected).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Свернуть Октябрь 2026' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Год 2026' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Выбрать найденные' })).toBeDisabled()
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('checkbox', { name: 'День 01.10.2026' })).toBeDisabled()
  })
})
