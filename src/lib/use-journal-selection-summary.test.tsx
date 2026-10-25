import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { summarizeJournalGridArea, summarizeJournalGridSelection } from '@/server/journal-grid-api'
import { useJournalSelectionSummary } from './use-journal-selection-summary'
import type { JournalSelectionSummary, JournalSummaryRange } from './journal-selection-summary'

vi.mock('@/server/journal-grid-api', () => ({ summarizeJournalGridArea: vi.fn(), summarizeJournalGridSelection: vi.fn() }))
const value: JournalSelectionSummary = { records: 3, joints: 2, wdi: 13, missingWdi: 0, weldDate: '01.09.2026 — 04.09.2026', missingDates: 0 }
beforeEach(() => { vi.useFakeTimers(); vi.mocked(summarizeJournalGridArea).mockReset().mockResolvedValue(value); vi.mocked(summarizeJournalGridSelection).mockReset().mockResolvedValue(value) })
afterEach(() => vi.useRealTimers())

it('coalesces checkbox changes into one POST and does not refetch on ordinary renders', async () => {
  const view = renderHook(({ ids }) => useJournalSelectionSummary(ids, 'current', true), { initialProps: { ids: new Set<number>() } })
  await act(async () => vi.advanceTimersByTimeAsync(200))
  expect(summarizeJournalGridSelection).not.toHaveBeenCalled()
  for (let n = 1; n <= 3; n++) view.rerender({ ids: new Set(Array.from({ length: n }, (_, i) => i + 1)) })
  await act(async () => vi.advanceTimersByTimeAsync(150))
  expect(summarizeJournalGridSelection).toHaveBeenCalledOnce()
  expect(vi.mocked(summarizeJournalGridSelection).mock.calls[0][0]?.data).toEqual({ ids: [1, 2, 3] })
  expect(view.result.current.summary).toEqual(value)
  const props = { ids: new Set([1, 2, 3]) }
  // Keep the selected Set identity, as the report does between actual changes.
  view.rerender(props)
  await act(async () => vi.advanceTimersByTimeAsync(150))
  vi.mocked(summarizeJournalGridSelection).mockClear()
  for (let n = 0; n < 10; n++) view.rerender(props)
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(summarizeJournalGridSelection).not.toHaveBeenCalled()
  view.unmount()
})

it('hides old totals immediately and discards a late response after changing or clearing selection', async () => {
  const finishes: ((value: JournalSelectionSummary) => void)[] = []
  vi.mocked(summarizeJournalGridSelection).mockImplementation(() => new Promise(resolve => finishes.push(resolve)))
  const view = renderHook(({ ids }) => useJournalSelectionSummary(ids, 'current', true), { initialProps: { ids: new Set([1]) } })
  await act(async () => vi.advanceTimersByTimeAsync(150))
  view.rerender({ ids: new Set([2, 3]) })
  expect(vi.mocked(summarizeJournalGridSelection).mock.calls[0][0]?.signal?.aborted).toBe(true)
  await act(async () => { finishes[0](value); await vi.advanceTimersByTimeAsync(150) })
  expect(view.result.current.summary).toBeUndefined()
  view.rerender({ ids: new Set() })
  await act(async () => finishes[1](value))
  expect(view.result.current.summary).toBeUndefined()
  view.unmount()
})

it('invalidates saved totals during a data refresh, retries errors explicitly and cancels on unmount', async () => {
  const ids = new Set([1])
  const view = renderHook(({ identity, ready }) => useJournalSelectionSummary(ids, identity, ready), { initialProps: { identity: 'before', ready: true } })
  await act(async () => vi.advanceTimersByTimeAsync(150))
  expect(view.result.current.summary).toEqual(value)
  view.rerender({ identity: 'after', ready: false })
  expect(view.result.current.summary).toBeUndefined()
  vi.mocked(summarizeJournalGridSelection).mockRejectedValueOnce(new Error('changed'))
  view.rerender({ identity: 'after', ready: true })
  await act(async () => vi.advanceTimersByTimeAsync(150))
  expect(view.result.current.error).toBe('changed')
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(summarizeJournalGridSelection).toHaveBeenCalledTimes(2)
  act(() => view.result.current.retry())
  await act(async () => vi.advanceTimersByTimeAsync(150))
  expect(view.result.current.summary).toEqual(value)
  view.unmount()
  expect(vi.mocked(summarizeJournalGridSelection).mock.lastCall?.[0]?.signal?.aborted).toBe(true)
})

const area = (end: number): JournalSummaryRange => ({ request: { columnFilters: {}, groupBy: [], revision: 1, anchor: 'line',
  parts: [{ route: [], start: 0, end, columns: ['id'] }] } })
it('prefers the area automatically, coalesces dragging, ignores checkbox changes and returns to checkbox totals', async () => {
  const ids = new Set([99])
  const view = renderHook(({ ids, range }) => useJournalSelectionSummary(ids, 'current', true, range), {
    initialProps: { ids, range: null as JournalSummaryRange },
  })
  await act(async () => vi.advanceTimersByTimeAsync(150))
  expect(summarizeJournalGridSelection).toHaveBeenCalledOnce()
  for (let end = 1; end < 10; end++) view.rerender({ ids, range: area(end) })
  const range = area(10)
  view.rerender({ ids, range })
  expect(view.result.current.summary).toBeUndefined()
  await act(async () => vi.advanceTimersByTimeAsync(150))
  expect(summarizeJournalGridArea).toHaveBeenCalledOnce()
  const nextIds = new Set([99, 100])
  view.rerender({ ids: nextIds, range })
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(summarizeJournalGridArea).toHaveBeenCalledOnce()
  expect(summarizeJournalGridSelection).toHaveBeenCalledOnce()
  view.rerender({ ids: nextIds, range: null })
  expect(view.result.current.summary).toBeUndefined()
  await act(async () => vi.advanceTimersByTimeAsync(150))
  expect(summarizeJournalGridSelection).toHaveBeenLastCalledWith(expect.objectContaining({ data: { ids: [99, 100] } }))
  view.unmount()
})
it('discards a late area response after clearing it and never substitutes checkbox totals for a broken range', async () => {
  let finish!: (summary: JournalSelectionSummary) => void
  vi.mocked(summarizeJournalGridArea).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = renderHook(({ range }) => useJournalSelectionSummary(new Set([99]), 'current', true, range), {
    initialProps: { range: area(3) },
  })
  await act(async () => vi.advanceTimersByTimeAsync(150))
  view.rerender({ range: { request: null, error: 'Wait for groups' } })
  await act(async () => finish(value))
  expect(vi.mocked(summarizeJournalGridArea).mock.calls[0][0].signal?.aborted).toBe(true)
  expect(view.result.current.summary).toBeUndefined()
  expect(view.result.current.error).toBe('Wait for groups')
  expect(summarizeJournalGridSelection).not.toHaveBeenCalled()
  view.unmount()
})
