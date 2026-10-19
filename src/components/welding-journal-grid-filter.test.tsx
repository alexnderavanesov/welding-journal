import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomFilterDisplayProps } from 'ag-grid-react'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'
import { JOURNAL_SERVER_FILTER } from './welding-journal-grid-filter'
import { JournalFilterContext } from './welding-journal-grid-context'
import type { AgGridWeldReport } from '@/lib/weld-report-grid-profile'

const mocks = vi.hoisted(() => ({ load: vi.fn(), close: vi.fn(), model: vi.fn() }))
vi.mock('@/server/weld-read-api', () => ({ listWeldColumnFilterOptions: mocks.load }))
vi.mock('ag-grid-react', () => ({ useGridFilterDisplay: (callbacks: { afterGuiAttached: (params: { hidePopup: () => void }) => void }) => {
  useEffect(() => { callbacks.afterGuiAttached({ hidePopup: mocks.close }) }, [])
} }))
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.clearAllMocks() })

function setup(field: WeldFieldKey, initial: string[] = [], report: AgGridWeldReport = 'weldingJournal') {
  const change = vi.fn(), client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  const Filter = JOURNAL_SERVER_FILTER.component
  function Test() {
    const [filters, setFilters] = useState<Record<string, string>>({ line: 'L1', ...(initial.length ? { [field]: buildWeldColumnValueFilter(initial) } : {}) })
    return <QueryClientProvider client={client}><JournalFilterContext.Provider value={{ report, columnFilters: filters, onColumnFiltersChange: next => { change(next); setFilters(next) } }}>
      <Filter {...({ column: { getColId: () => field, getColDef: () => ({ headerName: 'Дата' }) }, onModelChange: mocks.model } as unknown as CustomFilterDisplayProps)} />
    </JournalFilterContext.Provider></QueryClientProvider>
  }
  render(<Test />)
  return change
}

describe('journal grid date hierarchy', () => {
  it('isolates PSTO facets from journal cached results and keeps the full query scope', async () => {
    mocks.load.mockResolvedValue([{ value: 'проведено', label: 'проведено', count: 250 }])
    setup('pstoResult', [], 'heatTreatment')
    await screen.findByRole('checkbox', { name: /проведено/ })
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(mocks.load.mock.calls[0][0].data).toEqual({ report: 'heatTreatment', fieldKey: 'pstoResult', search: '', columnFilters: { line: 'L1' } })
    expect(clients.at(-1)!.getQueryCache().getAll().map(query => query.queryKey.slice(0, 3)))
      .toEqual([['weld-column-filter-options', 'heatTreatment', 'pstoResult']])
  })
  it.each(['01.10.2026', '01.10', '2026-10-01'])('finds the displayed date using %s without changing its source token or querying again', async search => {
    mocks.load.mockResolvedValue([
      { value: '2026-10-01', label: '2026-10-01', count: 2 },
      { value: '2026-10-02', label: '2026-10-02', count: 3 },
      { value: '', label: '(пусто)', count: 1 },
    ])
    const change = setup('weldDate')
    await screen.findByRole('checkbox', { name: 'Год 2026' })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: search } })
    expect(screen.getByRole('checkbox', { name: 'День 01.10.2026' })).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'День 02.10.2026' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /пусто/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать найденные' }))
    expect(parseWeldColumnChoiceFilter(change.mock.lastCall![0].weldDate)?.values).toEqual(['2026-10-01'])
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('filters the full query with exact date values and retains hidden selections when selecting a searched month', async () => {
    mocks.load.mockResolvedValue([{ value: '2026-10-01', label: '2026-10-01', count: 2 }, { value: '2026-09-01', label: '2026-09-01', count: 3 }, { value: '', label: '(пусто)', count: 4 }])
    const change = setup('weldDate', ['2026-09-01'])
    await screen.findByRole('checkbox', { name: 'Год 2026' })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2026-10' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Октябрь 2026' }))
    expect(parseWeldColumnChoiceFilter(change.mock.lastCall![0].weldDate)?.values).toEqual(['2026-09-01', '2026-10-01'])
    expect(change.mock.lastCall![0].line).toBe('L1')
    expect(mocks.model).toHaveBeenLastCalledWith({ value: change.mock.lastCall![0].weldDate })
    await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(mocks.load.mock.calls[0][0].data).toEqual({ report: 'weldingJournal', fieldKey: 'weldDate', search: '', columnFilters: { line: 'L1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтр' }))
    expect(change.mock.lastCall![0]).toEqual({ line: 'L1' })
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('selects every timestamp represented by a day, keeping milliseconds and empty values distinct', async () => {
    const first = '2026-10-01T21:10:00.001Z', second = '2026-10-01T21:10:00.002Z'
    mocks.load.mockResolvedValue([{ value: first, label: first, count: 2 }, { value: second, label: second, count: 3 }, { value: '', label: '(пусто)', count: 1 }])
    const change = setup('createdAt')
    await screen.findByRole('checkbox', { name: 'Год 2026' })
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть Год 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть Октябрь 2026' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'День 02.10.2026' }))
    expect(parseWeldColumnChoiceFilter(change.mock.lastCall![0].createdAt)?.values.sort()).toEqual([first, second])
    expect(screen.getByRole('checkbox', { name: /пусто/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: /пусто/ }))
    expect(parseWeldColumnChoiceFilter(change.mock.lastCall![0].createdAt)?.values.sort()).toEqual(['', first, second])
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(mocks.close).toHaveBeenCalledOnce()
  })
})
