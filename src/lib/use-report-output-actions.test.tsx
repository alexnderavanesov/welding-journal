import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useReportOutputActions } from '@/lib/use-report-output-actions'
import type { ActiveReport } from '@/lib/home-state'
import type { WeldInput } from '@/lib/weld-fields'

function params(activeReport: ActiveReport = 'weldingJournal') {
  return { activeReport, activeTitle: 'Отчёт', loadLnkRows: vi.fn(async () => []),
    loadPstoRows: vi.fn(async () => []), loadWeldingJournalRows: vi.fn<() => Promise<WeldInput[]>>(async () => []),
    setIsLnkShowMenuOpen: vi.fn(), setIsPstoShowMenuOpen: vi.fn(), setIsWeldingJournalShowMenuOpen: vi.fn(), setMessage: vi.fn() }
}
afterEach(() => vi.restoreAllMocks())

it.each([
  ['openLnkCurrentReport', 'loadLnkRows', 'current'],
  ['openLnkWaitingNkReport', 'loadLnkRows', 'waitingNk'],
  ['openLnkToRequestReport', 'loadLnkRows', 'waitingRequest'],
  ['openLnkConclusionsReport', 'loadLnkRows', 'conclusions'],
  ['openPstoCurrentReport', 'loadPstoRows', 'current'],
  ['openPstoWaitingRequestReport', 'loadPstoRows', 'waitingRequest'],
  ['openPstoResultsReport', 'loadPstoRows', 'results'],
  ['openWeldingJournalCurrentReport', 'loadWeldingJournalRows', 'current'],
  ['openWeldingJournalSystemReport', 'loadWeldingJournalRows', 'system'],
  ['openWeldingJournalWaitingWeldReport', 'loadWeldingJournalRows', 'waitingWeld'],
  ['openWeldingJournalWaitingRequestReport', 'loadWeldingJournalRows', 'waitingRequest'],
  ['openWeldingJournalWaitingControlReport', 'loadWeldingJournalRows', 'waitingControl'],
  ['openWeldingJournalWaitingRepairReport', 'loadWeldingJournalRows', 'waitingRepair'],
  ['openWeldingJournalCancelledAcceptedReport', 'loadWeldingJournalRows', 'cancelledAccepted'],
] as const)('%s opens an empty preview without popups and loads only the chosen slice', async (action, loader, kind) => {
  const popup = vi.spyOn(window, 'open').mockReturnValue(null)
  const p = params(), { result, rerender } = renderHook(() => useReportOutputActions(p))
  expect(result.current.reportPreviewProps).toBeNull()
  expect(p[loader]).not.toHaveBeenCalled()
  await act(async () => { await result.current[action]() })
  expect(p[loader]).toHaveBeenCalledExactlyOnceWith(kind)
  expect(result.current.reportPreviewProps?.report?.emptyMessage).toBeTruthy()
  expect(result.current.reportPreviewProps?.onDownloadExcel).toBeUndefined()
  expect(result.current.reportPreviewProps?.error).toBe('')
  rerender()
  window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online'))
  expect(p[loader]).toHaveBeenCalledTimes(1)
  expect(popup).not.toHaveBeenCalled()
})

it('keeps all 501 rows and date formatting, without generating Excel on open', async () => {
  const p = params()
  p.loadWeldingJournalRows.mockResolvedValue(Array.from({ length: 501 }, (_, i) => ({ joint: 'F' + (i + 1), weldDate: '2026-09-29' }) as WeldInput))
  const { result } = renderHook(() => useReportOutputActions(p))
  await act(async () => { await result.current.openWeldingJournalCurrentReport() })
  const report = result.current.reportPreviewProps?.report
  expect(report?.tables?.[0].rows).toHaveLength(501)
  expect(report?.tables?.[0].rows[500]).toContain('F501')
  expect(report?.tables?.[0].rows[0]).toContain('29.09.2026')
  expect(result.current.reportPreviewProps?.onDownloadExcel).toBeTypeOf('function')
})

it('opens loading immediately, coalesces duplicate clicks and ignores closed responses', async () => {
  const p = params()
  let resolve!: (rows: WeldInput[]) => void
  p.loadWeldingJournalRows.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const { result } = renderHook(() => useReportOutputActions(p))
  act(() => { void result.current.openWeldingJournalCurrentReport(); void result.current.openWeldingJournalCurrentReport() })
  expect(result.current.reportPreviewProps?.busy).toBe(true)
  expect(p.loadWeldingJournalRows).toHaveBeenCalledTimes(1)
  act(() => result.current.reportPreviewProps?.onClose())
  await act(async () => { await result.current.openWeldingJournalWaitingWeldReport() })
  const title = result.current.reportPreviewProps?.report?.title
  await act(async () => resolve([{ joint: 'OLD' } as WeldInput]))
  expect(result.current.reportPreviewProps?.report?.title).toBe(title)
  expect(p.loadWeldingJournalRows).toHaveBeenCalledTimes(2)
})

it('retries only explicitly, keeps the chosen slice and resets when leaving the report', async () => {
  const p = params()
  p.loadWeldingJournalRows.mockRejectedValueOnce(new Error('Нет соединения'))
  const { result, rerender } = renderHook(({ context }) => useReportOutputActions({ ...p, activeReport: context }), { initialProps: { context: 'weldingJournal' as ActiveReport } })
  await act(async () => { await result.current.openWeldingJournalWaitingRepairReport() })
  expect(result.current.reportPreviewProps?.error).toBe('Нет соединения')
  await act(async () => result.current.reportPreviewProps?.onRetry())
  expect(p.loadWeldingJournalRows).toHaveBeenNthCalledWith(2, 'waitingRepair')
  expect(result.current.reportPreviewProps?.error).toBe('')
  rerender({ context: 'lnk' })
  expect(result.current.reportPreviewProps).toBeNull()
})
