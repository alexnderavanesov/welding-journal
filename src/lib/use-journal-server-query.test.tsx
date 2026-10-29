import { useEffect, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { useJournalServerQuery } from './use-journal-server-query'
import type { JournalGridResult } from './journal-server-grid'
import type { WeldPageRefresh } from './weld-page-refresh'

const mocks = vi.hoisted(() => ({ read: vi.fn(), summary: vi.fn(), subscribe: vi.fn((_client: unknown, _listener: (event?: WeldPageRefresh) => void) => () => {}) }))
vi.mock('@/server/journal-grid-api', () => ({ readJournalGrid: mocks.read, getJournalReportSummary: mocks.summary }))
vi.mock('@/server/weld-read-api', () => ({ getWeldReportSummary: mocks.summary }))
vi.mock('./weld-page-refresh', () => ({ subscribeWeldPageRefresh: mocks.subscribe }))
const resultAt = (revision: number): JournalGridResult => ({ rows: [], rowCount: 200000, revision })
const block = { groupBy: [], route: [], start: 0, end: 100 }
it('keeps a healthy view and its actions when an auxiliary request discovers another writer', async () => {
  const { result } = renderHook(() => useJournalServerQuery({ enabled: true, columnFilters: {}, sort: null }), { wrapper })
  await act(async () => { await result.current.source.load(block) })
  act(() => result.current.source.rowsChanged([{ id: 1 }]))
  const identity = result.current.source.identity
  act(() => { result.current.source.recoverRevision?.(new Error('Данные журнала изменились. Обновите таблицу и повторите действие.')) })
  expect(result.current.source.identity).toBe(identity)
  expect(result.current.rowsReady).toBe(true)
  expect(result.current.rows).toEqual([{ id: 1 }])
  expect(mocks.read).toHaveBeenCalledTimes(1)
  expect(result.current.source.updatesAvailable).toBe(true)
  expect(result.current.source.revisionExpired).toBe(true)
  await expect(result.current.source.load({ ...block, start: 100, end: 200 })).rejects.toThrow('Данные журнала изменились')
  expect(mocks.read).toHaveBeenCalledTimes(1)
})
it('background changes only notify and leave editing available with an independent journal revision', async () => {
  const { result } = renderHook(() => useJournalServerQuery({ enabled: true, columnFilters: {}, sort: null }), { wrapper })
  await act(async () => { await result.current.source.load(block) })
  act(() => result.current.source.rowsChanged([{ id: 1 }]))
  const identity = result.current.source.identity
  act(() => mocks.subscribe.mock.lastCall![1]({ reason: 'background' }))
  expect(result.current.source.identity).toBe(identity)
  expect(result.current.source.updatesAvailable).toBe(true)
  expect(result.current.rowsReady).toBe(true)
  expect(mocks.read).toHaveBeenCalledTimes(1)
})
it.each(['success', 'failure'])('ignores a late %s from replaced grouping without losing the new revision', async outcome => {
  let finish!: (value: JournalGridResult) => void, fail!: (error: Error) => void
  mocks.read.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject }))
  const { result } = renderHook(() => useJournalServerQuery({ enabled: true, columnFilters: {}, sort: null }), { wrapper })
  const old = result.current.source.load(block).catch(error => error)
  mocks.read.mockResolvedValue(resultAt(2))
  await act(async () => { await result.current.source.load({ ...block, groupBy: ['line'] }) })
  const identity = result.current.source.identity
  await act(async () => {
    if (outcome === 'success') finish(resultAt(1))
    else fail(new Error('Данные журнала изменились. Обновите таблицу и повторите действие.'))
    expect((await old).name).toBe('AbortError')
  })
  expect(result.current.source.identity).toBe(identity)
  expect(result.current.error).toBeNull()
  await act(async () => { await result.current.source.load({ ...block, groupBy: ['line'], route: ['A'] }) })
  expect(mocks.read.mock.lastCall?.[0].data.revision).toBe(2)
  expect(mocks.summary).toHaveBeenCalledTimes(1)
})
it('blocks stale actions immediately while coalescing repeated mutation refresh notifications', async () => {
  vi.useFakeTimers()
  const { result, unmount } = renderHook(() => useJournalServerQuery({ report: 'lnk', enabled: true, columnFilters: {}, sort: null }), { wrapper })
  try {
    await act(async () => { await result.current.source.load(block) })
    expect(result.current.rowsReady).toBe(false)
    act(() => result.current.source.rowsChanged([{ id: 1 }]))
    expect(result.current.rowsReady).toBe(true)
    const source = result.current.source.identity
    const selection = result.current.selectionIdentity
    act(() => { for (let n = 0; n < 3; n++) mocks.subscribe.mock.lastCall![1]() })
    // A queued update from the old AG model must not re-enable actions during
    // the refresh debounce, before a new query identity has been assigned.
    act(() => result.current.source.rowsChanged([{ id: 1 }]))
    expect(result.current.rowsReady).toBe(false)
    expect(result.current.source.identity).toBe(source)
    await act(async () => { vi.advanceTimersByTime(80) })
    expect(result.current.source.identity).not.toBe(source)
    expect(result.current.selectionIdentity).toBe(selection)
    await act(async () => { await result.current.source.load(block) })
    expect(result.current.rowsReady).toBe(false)
    act(() => result.current.source.rowsChanged([{ id: 1 }]))
    expect(result.current.rowsReady).toBe(true)
    expect(mocks.read).toHaveBeenCalledTimes(2)
  } finally { unmount(); vi.useRealTimers() }
})
it('isolates report rows, late replies, revisions and the LNK request count on report switches', async () => {
  let finish!: (value: JournalGridResult) => void
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { result, rerender } = renderHook(({ report }: { report: 'lnk' | 'heatTreatment' }) =>
    useJournalServerQuery({ report, enabled: true, columnFilters: {}, sort: null }), { wrapper, initialProps: { report: 'lnk' } })
  const old = result.current.source.load(block).catch(error => error)
  rerender({ report: 'heatTreatment' })
  await act(async () => { finish(resultAt(1)); expect((await old).name).toBe('AbortError') })
  expect(mocks.summary).not.toHaveBeenCalled()
  await act(async () => { await result.current.source.load(block) })
  expect(mocks.read.mock.lastCall?.[0].data).toMatchObject({ report: 'heatTreatment', revision: undefined })
  expect(mocks.summary.mock.lastCall?.[0].data.report).toBe('heatTreatment')
  mocks.summary.mockResolvedValue({ total: 123, availableRequestCount: 17 })
  rerender({ report: 'lnk' })
  await act(async () => { await result.current.source.load(block) })
  act(() => result.current.source.rowsChanged(resultAt(1).rows))
  expect(result.current.availableRequestCount).toBe(17)
  expect(result.current.totalCount).toBe(123)
  expect(mocks.summary.mock.lastCall?.[0].data.report).toBe('lnk')
})
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockResolvedValue(resultAt(1))
  mocks.summary.mockResolvedValue({ total: 200000, acceptedWdiTotal: 100 })
})
it('does not commit readiness again for each successful neighbouring block', async () => {
  const commit = vi.fn()
  const { result } = renderHook(() => {
    const query = useJournalServerQuery({ enabled: true, columnFilters: {}, sort: null })
    useEffect(() => { commit() })
    return query
  }, { wrapper })
  await act(async () => { await result.current.source.load(block) })
  // Let the initial typing debounce settle outside the measured block updates.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
  commit.mockClear()
  for (let index = 1; index <= 3; index++) await act(async () => {
    await result.current.source.load({ ...block, start: index * 100, end: (index + 1) * 100 })
  })
  expect(commit).not.toHaveBeenCalled()
  expect(mocks.summary).toHaveBeenCalledTimes(1)
})
it('does not fetch cards or totals before the grid asks for a block', () => {
  renderHook(() => useJournalServerQuery({ enabled:true,columnFilters:{},sort:null }), { wrapper })
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.summary).not.toHaveBeenCalled()
})
it('does not serialize unchanged filters again on parent renders', () => {
  const columnFilters = { joint: 'x'.repeat(1000000), line: 'L' }
  const stringify = vi.spyOn(JSON, 'stringify')
  const { result, rerender, unmount } = renderHook(() => useJournalServerQuery({ enabled: true, columnFilters, sort: null }), { wrapper })
  try {
    const identity = result.current.source.identity
    stringify.mockClear()
    for (let index = 0; index < 5; index++) rerender()
    expect(result.current.source.identity).toBe(identity)
    expect(stringify.mock.calls.filter(([value]) => Array.isArray(value) && String(value).includes(columnFilters.joint))).toHaveLength(0)
    expect(mocks.read).not.toHaveBeenCalled()
  } finally { unmount(); stringify.mockRestore() }
})
it('pins blocks to one revision, and starts a fresh snapshot when regrouping replaces the whole view', async () => {
  const { result } = renderHook(() => useJournalServerQuery({ enabled:true,columnFilters:{},sort:null }), { wrapper })
  await act(async () => { await result.current.source.load(block) })
  expect(mocks.read.mock.calls[0][0].data.revision).toBeUndefined()
  await act(async () => { await result.current.source.load({ ...block,start:100,end:200 }) })
  expect(mocks.read.mock.calls[1][0].data.revision).toBe(1)
  mocks.read.mockResolvedValue(resultAt(2))
  await act(async () => { await result.current.source.load({ ...block,groupBy:['line'] }) })
  expect(mocks.read.mock.calls[2][0].data.revision).toBeUndefined()
  await act(async () => { await result.current.source.load({ ...block,groupBy:['line'],route:['L'] }) })
  expect(mocks.read.mock.calls[3][0].data.revision).toBe(2)
  expect(mocks.summary).toHaveBeenCalledTimes(2)
  act(() => result.current.source.rowsChanged([]))
  expect(result.current.rowsReady).toBe(true)
})
it('does not publish a response from a replaced filter', async () => {
  let finish!: (value:JournalGridResult) => void
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { result, rerender } = renderHook(({ search }) => useJournalServerQuery({ enabled:true,columnFilters:{search},sort:null }), { wrapper,initialProps:{search:'A'} })
  const pending = result.current.source.load(block).catch(error => error)
  rerender({ search:'B' })
  await act(async () => { finish(resultAt(1)); expect((await pending).name).toBe('AbortError') })
  expect(result.current.rowsReady).toBe(false)
  expect(result.current.error).toBeNull()
  expect(mocks.summary).not.toHaveBeenCalled()
})
it('does not carry a summary error into a new filter or explicit retry', async () => {
  mocks.summary.mockRejectedValueOnce(new Error('Summary unavailable'))
  const { result, rerender } = renderHook(({ line }) => useJournalServerQuery({ enabled: true, columnFilters: { line }, sort: null }), {
    wrapper, initialProps: { line: 'A' },
  })
  await act(async () => { await result.current.source.load(block) })
  expect(result.current.summaryStatus).toBe('error')
  rerender({ line: 'B' })
  expect(result.current.summaryStatus).toBe('pending')
  expect(result.current.summaryError).toBeUndefined()
  mocks.summary.mockRejectedValueOnce(new Error('Still unavailable'))
  await act(async () => { await result.current.source.load(block) })
  expect(result.current.summaryStatus).toBe('error')
  await act(async () => { await result.current.refetch() })
  expect(result.current.summaryStatus).toBe('pending')
  expect(result.current.summaryError).toBeUndefined()
  await act(async () => { await result.current.source.load(block) })
  act(() => result.current.source.rowsChanged(resultAt(1).rows))
  expect(result.current.summaryStatus).toBe('ready')
  expect(mocks.summary).toHaveBeenCalledTimes(3)
})
it('refresh invalidates journal facets without fetching closed popups or other reports', async () => {
  const client = new QueryClient()
  const journal = ['weld-column-filter-options', 'weldingJournal', 'isometry', {}, 'paged', 'first']
  const dates = ['weld-column-filter-options', 'weldingJournal', 'weldDate', {}]
  const matches = ['weld-column-filter-options', 'weldingJournal', 'isometry', {}, 'paged', 'matches', 'A', 1]
  const other = ['weld-column-filter-options', 'lnk', 'isometry', {}]
  for (const key of [journal, dates, matches, other]) client.setQueryData(key, ['old'])
  const { result } = renderHook(() => useJournalServerQuery({ enabled: true, columnFilters: {}, sort: null }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
  await act(async () => { await result.current.refetch() })
  expect(client.getQueryState(journal)?.isInvalidated).toBe(true)
  expect(client.getQueryState(dates)?.isInvalidated).toBe(true)
  // Matches belong to a revision. Updating the first page switches their key;
  // fetching the old revision here would waste work and produce stale errors.
  expect(client.getQueryState(matches)?.isInvalidated).toBe(false)
  expect(client.getQueryState(other)?.isInvalidated).toBe(false)
  expect(client.isFetching()).toBe(0)
})
it('a failed block disables actions and a changed snapshot gets only one automatic retry', async () => {
  const { result } = renderHook(() => useJournalServerQuery({ enabled:true,columnFilters:{},sort:null }), { wrapper })
  await act(async () => { await result.current.source.load(block) })
  const identity = result.current.source.identity
  mocks.read.mockRejectedValue(new Error('Данные журнала изменились. Обновите таблицу и повторите действие.'))
  await act(async () => { await expect(result.current.source.load(block)).rejects.toMatchObject({ name:'AbortError' }) })
  await waitFor(() => expect(result.current.source.identity).not.toBe(identity))
  expect(result.current.rowsReady).toBe(false)
  expect(result.current.error).toBeNull()
  const retryIdentity = result.current.source.identity
  await act(async () => { await expect(result.current.source.load(block)).rejects.toThrow('Данные журнала изменились') })
  expect(result.current.source.identity).toBe(retryIdentity)
  expect(result.current.rowsReady).toBe(false)
  expect(result.current.source.error?.message).toContain('Данные журнала изменились')
})

it('coalesces expired counters without restarting a healthy view; explicit refresh opens the new version', async () => {
  const { result } = renderHook(() => useJournalServerQuery({ enabled: true, columnFilters: {}, sort: null }), { wrapper })
  const changed = new Error('Данные журнала изменились. Обновите таблицу и повторите действие.')
  await act(async () => { await result.current.source.load(block) })
  act(() => result.current.source.rowsChanged([{ id: 1 }]))
  const first = result.current.source
  act(() => {
    expect(first.recoverRevision?.(changed)).toBe(true)
    expect(first.recoverRevision?.(changed)).toBe(true)
    first.rowsChanged([{ id: 1 }])
  })
  expect(result.current.rowsReady).toBe(true)
  expect(result.current.source.identity).toBe(first.identity)
  await act(async () => { await result.current.refetch() })
  const next = result.current.source.identity
  expect(JSON.parse(next).at(-1)).toBe(1)
  mocks.read.mockResolvedValue(resultAt(2))
  await act(async () => { await result.current.source.load(block) })
  expect(result.current.rowsReady).toBe(false)
  act(() => result.current.source.rowsChanged([{ id: 2 }]))
  expect(result.current.rowsReady).toBe(true)
  act(() => { expect(result.current.source.recoverRevision?.(changed)).toBe(true) })
  expect(JSON.parse(result.current.source.identity).at(-1)).toBe(1)
  expect(result.current.rowsReady).toBe(true)
  expect(mocks.read).toHaveBeenCalledTimes(2)
  expect(result.current.source.recoverRevision?.(new Error('Failed query'))).toBe(false)
})

it('applies checkbox filters and sort immediately, reusing summary across sort-only changes', async () => {
  const { result, rerender } = renderHook(({ line, direction }) => useJournalServerQuery({
    enabled:true,columnFilters:{line},sort:direction ? {fieldKey:'joint',direction} : null,
  }), { wrapper,initialProps:{line:'A',direction:null as 'asc'|'desc'|null} })
  await act(async()=>{await result.current.source.load(block)})
  const previous=result.current.source.identity
  rerender({line:'A',direction:'asc'})
  expect(result.current.source.identity).not.toBe(previous)
  await act(async()=>{await result.current.source.load(block)})
  expect(mocks.summary).toHaveBeenCalledTimes(1)
  const sorted=result.current.source.identity
  rerender({line:'B',direction:'asc'})
  expect(result.current.source.identity).not.toBe(sorted)
  await act(async()=>{await result.current.source.load(block)})
  expect(mocks.read.mock.lastCall?.[0].data.columnFilters).toEqual({line:'B'})
  expect(mocks.summary).toHaveBeenCalledTimes(2)
})
it('debounces search typing and flushes the current draft when a checkbox filter changes', async () => {
  const {result,rerender}=renderHook(({search,line})=>useJournalServerQuery({enabled:true,columnFilters:{search,line},sort:null}),{
    wrapper,initialProps:{search:'A',line:''},
  })
  const previous=result.current.source.identity
  rerender({search:'AB',line:''})
  expect(result.current.source.identity).toBe(previous)
  await expect(result.current.source.load(block)).rejects.toMatchObject({name:'AbortError'})
  rerender({search:'AB',line:'L'})
  expect(result.current.source.identity).not.toBe(previous)
  await act(async()=>{await result.current.source.load(block)})
  expect(mocks.read.mock.lastCall?.[0].data.columnFilters).toEqual({search:'AB',line:'L'})
})

it('keeps a real block failure visible across neighbouring successes and clears it when retry starts', async () => {
  const { result } = renderHook(() => useJournalServerQuery({ enabled: true, columnFilters: {}, sort: null }), { wrapper })
  mocks.read.mockRejectedValueOnce(new Error('Connection lost'))
  await act(async () => { await expect(result.current.source.load(block)).rejects.toThrow('Connection lost') })
  expect(result.current.source.error?.message).toBe('Не удалось загрузить данные. Повторите загрузку таблицы.')
  await act(async () => { await result.current.source.load({ ...block, start: 100, end: 200 }) })
  expect(result.current.rowsReady).toBe(false)
  expect(result.current.source.error?.message).toBe('Не удалось загрузить данные. Повторите загрузку таблицы.')
  await act(async () => { result.current.source.retry?.() })
  expect(result.current.source.error).toBeNull()
  expect(result.current.error).toBeNull()
  await act(async () => { await result.current.source.load(block) })
  act(() => result.current.source.rowsChanged(resultAt(1).rows))
  expect(result.current.rowsReady).toBe(true)
})
