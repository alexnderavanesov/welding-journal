import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { useReportSelectionAction } from '@/lib/use-report-selection-action'

const rows = Array.from({ length: 500 }, (_, index): WeldRow => ({ id: index + 1, joint: `F${index + 1}`, rowVersion: 'v1' }))
const selectedIds = new Set(rows.map(row => row.id))
const pageRows = rows.slice(0, 100)

function deferred() {
  let resolve!: (value: WeldRow[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<WeldRow[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup(initial = { rowsReady: true, queryIdentity: 'lnk:A', selectedIds, rows: pageRows }) {
  const pending = deferred()
  const loadRowsByIds = vi.fn(() => pending.promise)
  const onOpen = vi.fn(), onError = vi.fn()
  const hook = renderHook(props => useReportSelectionAction({ ...props, loadRowsByIds, onOpen, onError }), {
    initialProps: initial,
  })
  return { ...hook, pending, loadRowsByIds, onOpen, onError, initial }
}

describe('report selection action opening', () => {
  it('reopens all 500 selected IDs after Cancel with only 100 report rows materialized', async () => {
    const { result, pending, loadRowsByIds, onOpen, onError } = setup()
    expect(result.current.disabled).toBe(false)
    let running!: Promise<void>
    act(() => { running = result.current.run() })
    expect(loadRowsByIds).toHaveBeenCalledExactlyOnceWith([...selectedIds])
    expect(result.current.disabled).toBe(true)
    expect(onOpen).not.toHaveBeenCalled()
    await act(async () => { pending.resolve([...rows].reverse()); await running })
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(rows)
    expect(onError).not.toHaveBeenCalled()
    expect(selectedIds.size).toBe(500)
    expect(result.current.disabled).toBe(false)
  })

  it('opens an already materialized selection without another request', async () => {
    const { result, loadRowsByIds, onOpen } = setup({ rowsReady: true, queryIdentity: 'lnk:A', selectedIds: new Set([1, 2]), rows: pageRows })
    await act(() => result.current.run())
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(rows.slice(0, 2))
    expect(loadRowsByIds).not.toHaveBeenCalled()
  })

  it('keeps pending hydration across equivalent display-row arrays recreated by controller renders', async () => {
    const pending = deferred(), onOpen = vi.fn(), onError = vi.fn()
    const loadRowsByIds = vi.fn(() => pending.promise)
    const { result } = renderHook(() => useReportSelectionAction({
      rowsReady: true, queryIdentity: 'lnk:A', selectedIds,
      rows: pageRows.map(row => ({ ...row })), loadRowsByIds, onOpen, onError,
    }))
    let running!: Promise<void>
    act(() => { running = result.current.run() })
    expect(result.current.disabled).toBe(true)
    await act(async () => { pending.resolve(rows); await running })
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(rows)
    expect(loadRowsByIds).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('refreshes loaded selections in one batch and refuses a missing joint before opening an operation', async () => {
    const onOpen = vi.fn(), onError = vi.fn(), loadRowsByIds = vi.fn().mockResolvedValue([{ ...rows[0], rowVersion: 'v2' }])
    const { result } = renderHook(() => useReportSelectionAction({ fresh: true, rowsReady: true,
      queryIdentity: 'journal', selectedIds: new Set([1]), rows: pageRows, loadRowsByIds, onOpen, onError }))
    await act(() => result.current.run())
    expect(loadRowsByIds).toHaveBeenCalledExactlyOnceWith([1])
    expect(onOpen).toHaveBeenCalledExactlyOnceWith([{ ...rows[0], rowVersion: 'v2' }])
    loadRowsByIds.mockResolvedValueOnce([])
    await act(() => result.current.run([2]))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('blocks stale report rows immediately, even with a fully materialized selection', async () => {
    const { result, loadRowsByIds, onOpen } = setup({ rowsReady: false, queryIdentity: 'lnk:B', selectedIds: new Set([1]), rows: pageRows })
    expect(result.current.disabled).toBe(true)
    await act(() => result.current.run())
    expect(loadRowsByIds).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not fetch the journal for an empty selection', async () => {
    const { result, loadRowsByIds, onOpen } = setup({ rowsReady: true, queryIdentity: 'lnk:A', selectedIds: new Set(), rows: pageRows })
    await act(() => result.current.run())
    expect(loadRowsByIds).not.toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith([])
  })

  it('loads the 5000-ID workflow limit in one explicit call without fan-out', async () => {
    const allRows = Array.from({ length: 5000 }, (_, index): WeldRow => ({ id: index + 1, rowVersion: 'v1' }))
    const ids = new Set(allRows.map(row => row.id))
    const { result, pending, loadRowsByIds, onOpen } = setup({ rowsReady: true, queryIdentity: 'lnk:A', selectedIds: ids, rows: pageRows })
    let running!: Promise<void>
    act(() => { running = result.current.run() })
    expect(loadRowsByIds).toHaveBeenCalledExactlyOnceWith([...ids])
    await act(async () => { pending.resolve(allRows); await running })
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(allRows)
  })

  it('coalesces repeated clicks and never starts an automatic request', async () => {
    const { result, pending, loadRowsByIds, onOpen } = setup()
    expect(loadRowsByIds).not.toHaveBeenCalled()
    let first!: Promise<void>, second!: Promise<void>
    act(() => { first = result.current.run(); second = result.current.run() })
    expect(loadRowsByIds).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(rows); await Promise.all([first, second]) })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('cancels an explicit menu intent and permits retry before the old request settles', async () => {
    const { result, pending, loadRowsByIds, onOpen, onError } = setup()
    let first!: Promise<void>, second!: Promise<void>
    act(() => { first = result.current.run() })
    act(() => { result.current.cancel() })
    expect(result.current.disabled).toBe(false)
    const retry = deferred()
    loadRowsByIds.mockImplementationOnce(() => retry.promise)
    act(() => { second = result.current.run(); void result.current.run() })
    expect(loadRowsByIds).toHaveBeenCalledTimes(2)
    await act(async () => { pending.resolve(rows); await first })
    expect(onOpen).not.toHaveBeenCalled()
    expect(result.current.disabled).toBe(true)
    await act(async () => { retry.resolve(rows); await second })
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(rows)
    expect(onError).not.toHaveBeenCalled()
  })

  it.each(['missing', 'extra', 'duplicate', 'error'] as const)('refuses %s data without clearing, truncating or expanding selection', async kind => {
    const { result, pending, loadRowsByIds, onOpen, onError } = setup()
    let running!: Promise<void>
    act(() => { running = result.current.run() })
    expect(loadRowsByIds).toHaveBeenCalledTimes(1)
    await act(async () => {
      if (kind === 'error') pending.reject(new Error('offline'))
      else pending.resolve(kind === 'missing' ? rows.slice(1) : kind === 'extra' ? [...rows, { id: 999 }] : [...rows.slice(1), rows[1]!])
      await running
    })
    expect(onOpen).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(loadRowsByIds).toHaveBeenCalledTimes(1)
    expect(selectedIds).toEqual(new Set(rows.map(row => row.id)))
    expect(result.current.disabled).toBe(false)
  })

  it.each(['identity', 'selection', 'readiness', 'version'] as const)('ignores a late response after an A/B/A %s change', async change => {
    const { result, rerender, initial, pending, loadRowsByIds, onOpen, onError } = setup()
    let running!: Promise<void>
    act(() => { running = result.current.run() })
    expect(loadRowsByIds).toHaveBeenCalledTimes(1)
    rerender({ ...initial, ...(change === 'identity' ? { queryIdentity: 'lnk:B' }
      : change === 'selection' ? { selectedIds: new Set([1]) }
      : change === 'readiness' ? { rowsReady: false } : { rows: [{ ...pageRows[0]!, rowVersion: 'v2' }, ...pageRows.slice(1)] }) })
    rerender(initial)
    await act(async () => { pending.resolve(rows); await running })
    expect(onOpen).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(selectedIds.size).toBe(500)
  })

  it('does not show an old request error in new conditions', async () => {
    const { result, rerender, initial, pending, loadRowsByIds, onOpen, onError } = setup()
    let running!: Promise<void>
    act(() => { running = result.current.run() })
    expect(loadRowsByIds).toHaveBeenCalledTimes(1)
    rerender({ ...initial, queryIdentity: 'lnk:B' })
    await act(async () => { pending.reject(new Error('late error A')); await running })
    expect(onOpen).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('retries only after another explicit click and preserves the entire selection', async () => {
    const { result, pending, loadRowsByIds, onOpen, onError } = setup()
    let running!: Promise<void>
    act(() => { running = result.current.run() })
    await act(async () => { pending.reject(new Error('offline')); await running })
    expect(loadRowsByIds).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledExactlyOnceWith('offline')
    loadRowsByIds.mockResolvedValueOnce(rows)
    await act(() => result.current.run())
    expect(loadRowsByIds).toHaveBeenCalledTimes(2)
    expect(loadRowsByIds).toHaveBeenLastCalledWith([...selectedIds])
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(rows)
  })

  it('ignores pending data after unmount', async () => {
    const { result, unmount, pending, onOpen, onError } = setup()
    let running!: Promise<void>
    act(() => { running = result.current.run() })
    unmount()
    await act(async () => { pending.resolve(rows); await running })
    expect(onOpen).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([
    { closeAgain: false, reject: false },
    { closeAgain: true, reject: false },
    { closeAgain: false, reject: true },
    { closeAgain: true, reject: true },
  ])('does not steal another dialog intent (closed again: $closeAgain, error: $reject)', async ({ closeAgain, reject }) => {
    const pending = deferred(), onOpen = vi.fn(), onError = vi.fn()
    const loadRowsByIds = vi.fn(() => pending.promise)
    const initial = { rowsReady: true, queryIdentity: 'lnk:A', selectedIds, rows: pageRows, isModalOpen: false }
    const { result, rerender } = renderHook(props => useReportSelectionAction({ ...props, loadRowsByIds, onOpen, onError }), { initialProps: initial })
    let running!: Promise<void>
    act(() => { running = result.current.run() })
    expect(loadRowsByIds).toHaveBeenCalledTimes(1)
    rerender({ ...initial, isModalOpen: true })
    if (closeAgain) rerender(initial)
    await act(async () => {
      if (reject) pending.reject(new Error('late dialog error'))
      else pending.resolve(rows)
      await running
    })
    expect(onOpen).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(selectedIds.size).toBe(500)
    if (closeAgain) {
      loadRowsByIds.mockResolvedValueOnce(rows)
      await act(() => result.current.run())
      expect(onOpen).toHaveBeenCalledExactlyOnceWith(rows)
      expect(loadRowsByIds).toHaveBeenCalledTimes(2)
    }
  })

  it('blocks entry while another dialog is open, including already materialized rows', async () => {
    const onOpen = vi.fn(), onError = vi.fn(), loadRowsByIds = vi.fn(async () => rows)
    const props = { rowsReady: true, queryIdentity: 'lnk:A', selectedIds: new Set([1]), rows: pageRows, isModalOpen: true }
    const { result } = renderHook(() => useReportSelectionAction({ ...props, loadRowsByIds, onOpen, onError }))
    expect(result.current.disabled).toBe(true)
    await act(() => result.current.run())
    expect(onOpen).not.toHaveBeenCalled()
    expect(loadRowsByIds).not.toHaveBeenCalled()
  })
})
