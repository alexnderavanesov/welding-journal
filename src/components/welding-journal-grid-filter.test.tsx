import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomFilterDisplayProps } from 'ag-grid-react'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'
import { JOURNAL_SERVER_FILTER } from './welding-journal-grid-filter'
import { JournalFilterContext } from './welding-journal-grid-context'
import type { AgGridWeldReport } from '@/lib/weld-report-grid-profile'

const mocks = vi.hoisted(() => ({ load: vi.fn(), page: vi.fn(), select: vi.fn(), close: vi.fn(), model: vi.fn() }))
vi.mock('@/server/weld-read-api', () => ({ listWeldColumnFilterOptions: mocks.load }))
vi.mock('@/server/journal-grid-api', () => ({ listJournalFilterOptions: mocks.load, readJournalFilterPage: mocks.page, selectJournalFilterValues: mocks.select }))
vi.mock('ag-grid-react', () => ({ useGridFilterDisplay: (callbacks: { afterGuiAttached: (params: { hidePopup: () => void }) => void; afterGuiDetached?: () => void }) => {
  useEffect(() => { callbacks.afterGuiAttached({ hidePopup: () => { mocks.close(); callbacks.afterGuiDetached?.() } }) }, [])
} }))
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.clearAllMocks() })

function setup(field: WeldFieldKey, initial: string[] = [], report: AgGridWeldReport = 'weldingJournal', deferModelChanges = false) {
  const change = vi.fn(), client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  const Filter = JOURNAL_SERVER_FILTER.component
  function Test() {
    const [filters, setFilters] = useState<Record<string, string>>({ line: 'L1', ...(initial.length ? { [field]: buildWeldColumnValueFilter(initial) } : {}) })
    return <QueryClientProvider client={client}><JournalFilterContext.Provider value={{ report, deferModelChanges, columnFilters: filters, onColumnFiltersChange: next => { change(next); setFilters(next) } }}>
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


it('updates journal filter choices without purging AG stores before the prepared result', async () => {
  mocks.load.mockResolvedValue([{ value: '2026-10-01', label: '2026-10-01', count: 2 }])
  const change = setup('weldDate', [], 'weldingJournal', true)
  await screen.findByRole('checkbox', { name: 'Год 2026' })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Год 2026' }))
  expect(parseWeldColumnChoiceFilter(change.mock.lastCall![0].weldDate)?.values).toEqual(['2026-10-01'])
  expect(mocks.model).not.toHaveBeenCalled()
})

it('keeps small lists instantaneous and searches displayed numeric labels locally', async () => {
  mocks.page.mockResolvedValue({ options: [{ value: '12.5', label: '12.5', count: 2 }, { value: '3', label: '3', count: 1 }], total: 2, revision: 7 })
  const change = setup('wdi')
  await screen.findByRole('checkbox', { name: /12,5/ })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '12.5' } })
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать найденные' }))
  expect(parseWeldColumnChoiceFilter(change.mock.lastCall![0].wdi)?.values).toEqual(['12.5'])
  expect(mocks.page).toHaveBeenCalledOnce(); expect(mocks.select).not.toHaveBeenCalled()
})
it('renders common lists in small portions while keeping full local search and selection', async () => {
  mocks.page.mockResolvedValue({ options: Array.from({length:350},(_,i)=>({value:`J${i}`,label:`J${i}`,count:1})), total:350, revision:7 })
  const change = setup('joint')
  await screen.findByRole('checkbox', {name:/J0/})
  expect(screen.getAllByRole('checkbox')).toHaveLength(150)
  fireEvent.click(screen.getByRole('button', {name:/Ещё значения/}))
  expect(screen.getAllByRole('checkbox')).toHaveLength(300)
  fireEvent.change(screen.getByRole('textbox'), {target:{value:'J349'}})
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', {name:'Выбрать найденные'}))
  expect(parseWeldColumnChoiceFilter(change.mock.lastCall![0].joint)?.values).toEqual(['J349'])
  expect(mocks.page).toHaveBeenCalledOnce(); expect(mocks.select).not.toHaveBeenCalled()
})
it('loads another page on the first More click and selects all remote matches, including unseen ones', async () => {
  mocks.page.mockImplementation(async ({ data }) => ({ options: [{ value: data.start ? 'J002' : 'J001', label: data.start ? 'J002' : 'J001', count: 1 }], total: 1000, next: data.start ? 2 : 1, revision: 7 }))
  mocks.select.mockResolvedValue({ revision: 7, values: ['J001', 'J002', 'J999'] })
  const change = setup('joint')
  await screen.findByRole('checkbox', { name: /J001/ })
  fireEvent.click(screen.getByRole('button', { name: /Ещё значения/ }))
  await screen.findByRole('checkbox', { name: /J002/ })
  expect(mocks.page.mock.lastCall![0].data.start).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать найденные' }))
  await waitFor(() => expect(parseWeldColumnChoiceFilter(change.mock.lastCall?.[0].joint ?? '')?.values).toEqual(['J001', 'J002', 'J999']))
  expect(mocks.select.mock.lastCall![0].data).toMatchObject({ fieldKey: 'joint', revision: 7, match: '' })
})
it('ignores a late Select Found result after the search changes', async () => {
  mocks.page.mockResolvedValue({ options: [{ value: 'J001', label: 'J001', count: 1 }], total: 1000, next: 1, revision: 7 })
  let finish!: (value: unknown) => void
  mocks.select.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const change = setup('joint')
  await screen.findByRole('checkbox', { name: /J001/ })
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать найденные' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'other' } })
  await act(async () => finish({ values: ['J001', 'J999'], revision: 7 }))
  expect(change).not.toHaveBeenCalled()
  expect(mocks.select.mock.lastCall![0].signal.aborted).toBe(true)
})
it('cancels pending Select Found when Escape closes a retained filter popup', async () => {
  mocks.page.mockResolvedValue({ options: [{ value: 'J001', label: 'J001', count: 1 }], total: 1000, next: 1, revision: 7 })
  let finish!: (value: unknown) => void
  mocks.select.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const change = setup('joint')
  await screen.findByRole('checkbox', { name: /J001/ })
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать найденные' }))
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
  await act(async () => finish({ values: ['J001', 'J999'], revision: 7 }))
  expect(mocks.close).toHaveBeenCalledOnce()
  expect(change).not.toHaveBeenCalled()
  expect(mocks.select.mock.lastCall![0].signal.aborted).toBe(true)
})
