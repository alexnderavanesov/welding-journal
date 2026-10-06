import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useReportPreview } from './use-report-preview'
import type { ReportPreviewContent } from './tabular-report'

function deferredReport() {
  let resolve!: (value: ReportPreviewContent) => void
  const promise = new Promise<ReportPreviewContent>(done => { resolve = done })
  return { resolve, load: vi.fn(() => promise) }
}

it('coalesces double opening and ignores a late response after closing the preview', async () => {
  const pending = deferredReport()
  const { result } = renderHook(() => useReportPreview('journal'))
  let opening!: Promise<void>
  act(() => { opening = result.current.open(pending.load); void result.current.open(pending.load) })
  expect(pending.load).toHaveBeenCalledTimes(1)
  expect(result.current.previewProps?.busy).toBe(true)
  act(() => result.current.previewProps!.onClose())
  await act(async () => { pending.resolve({ report: { title: 'Closed' } }); await opening })
  expect(result.current.previewProps).toBeNull()
})

it('cannot replace a newer preview with a stale response from another section', async () => {
  const first = deferredReport(), second = deferredReport()
  const { result, rerender } = renderHook(({ context }) => useReportPreview(context), { initialProps: { context: 'journal' } })
  let oldOpening!: Promise<void>, newOpening!: Promise<void>
  act(() => { oldOpening = result.current.open(first.load) })
  rerender({ context: 'lnk' })
  act(() => { newOpening = result.current.open(second.load) })
  await act(async () => { second.resolve({ report: { title: 'LNK' } }); await newOpening })
  await act(async () => { first.resolve({ report: { title: 'Journal' } }); await oldOpening })
  expect(result.current.previewProps?.report?.title).toBe('LNK')
  expect(first.load).toHaveBeenCalledTimes(1)
  expect(second.load).toHaveBeenCalledTimes(1)
})

it('retries only on an explicit click, not on focus/reconnect or rerender', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('Failure')).mockResolvedValueOnce({ report: { title: 'Retried' } })
  const { result, rerender } = renderHook(() => useReportPreview('journal'))
  await act(async () => result.current.open(load))
  expect(result.current.previewProps?.error).toBe('Failure')
  act(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  rerender()
  expect(load).toHaveBeenCalledTimes(1)
  await act(async () => result.current.previewProps!.onRetry())
  expect(result.current.previewProps?.report?.title).toBe('Retried')
  expect(load).toHaveBeenCalledTimes(2)
})
