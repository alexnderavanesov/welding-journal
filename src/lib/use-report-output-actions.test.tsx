import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

const reportWindowMocks = vi.hoisted(() => ({
  openCurrentReportWindow: vi.fn(async () => ({ ok: true as const })),
  openLnkConclusionsReportWindow: vi.fn(async () => ({ ok: true as const })),
  openLnkToRequestReportWindow: vi.fn(async () => ({ ok: true as const })),
  openLnkWaitingNkReportWindow: vi.fn(async () => ({ ok: true as const })),
  openPstoResultsReportWindow: vi.fn(async () => ({ ok: true as const })),
  openPstoWaitingRequestReportWindow: vi.fn(async () => ({ ok: true as const })),
  openWeldingJournalCancelledAcceptedReportWindow: vi.fn(async () => ({ ok: true as const })),
  openWeldingJournalCurrentReportWindow: vi.fn(async () => ({ ok: true as const })),
  openWeldingJournalSystemReportWindow: vi.fn(async () => ({ ok: true as const })),
  openWeldingJournalWaitingControlReportWindow: vi.fn(async () => ({ ok: true as const })),
  openWeldingJournalWaitingRepairReportWindow: vi.fn(async () => ({ ok: true as const })),
  openWeldingJournalWaitingRequestReportWindow: vi.fn(async () => ({ ok: true as const })),
  openWeldingJournalWaitingWeldReportWindow: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('@/lib/report-show-windows', () => reportWindowMocks)

const windowMocks = vi.hoisted(() => ({
  reserveTabularReportWindow: vi.fn(),
}))
vi.mock('@/lib/report-window', () => windowMocks)

import { useReportOutputActions } from '@/lib/use-report-output-actions'

describe('report output loading', () => {
  const targetWindow = { close: vi.fn() } as unknown as Window

  beforeEach(() => {
    vi.clearAllMocks()
    windowMocks.reserveTabularReportWindow.mockReturnValue(targetWindow)
  })

  it('does not load welding-journal rows until the user chooses an output', async () => {
    const rows = [{ id: 1, joint: 'F1' }] as WeldInput[]
    const loadWeldingJournalRows = vi.fn(async () => rows)
    const setShowMenuOpen = vi.fn()
    const setMessage = vi.fn()
    const { result } = renderHook(() => useReportOutputActions({
      activeReport: 'weldingJournal',
      activeTitle: 'Сварочный журнал',
      loadLnkRows: vi.fn(async () => []),
      loadPstoRows: vi.fn(async () => []),
      loadWeldingJournalRows,
      setIsLnkShowMenuOpen: vi.fn(),
      setIsPstoShowMenuOpen: vi.fn(),
      setIsWeldingJournalShowMenuOpen: setShowMenuOpen,
      setMessage,
    }))

    expect(loadWeldingJournalRows).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.openWeldingJournalCurrentReport()
    })

    expect(setShowMenuOpen).toHaveBeenCalledWith(false)
    expect(windowMocks.reserveTabularReportWindow).toHaveBeenCalledWith('сварочного журнала')
    expect(loadWeldingJournalRows).toHaveBeenCalledTimes(1)
    expect(loadWeldingJournalRows).toHaveBeenCalledWith('current')
    expect(reportWindowMocks.openWeldingJournalCurrentReportWindow).toHaveBeenCalledWith(
      rows,
      expect.any(Array),
      targetWindow,
    )
    expect(setMessage).toHaveBeenNthCalledWith(1, 'Загружаем данные отчета сварочного журнала…')
    expect(setMessage).toHaveBeenLastCalledWith(null)
  })

  it('reserves the report tab before the network request finishes', async () => {
    let resolveRows!: (rows: WeldInput[]) => void
    const loadWeldingJournalRows = vi.fn(() => new Promise<WeldInput[]>((resolve) => {
      resolveRows = resolve
    }))
    const { result } = renderHook(() => useReportOutputActions({
      activeReport: 'weldingJournal',
      activeTitle: 'Сварочный журнал',
      loadLnkRows: vi.fn(async () => []),
      loadPstoRows: vi.fn(async () => []),
      loadWeldingJournalRows,
      setIsLnkShowMenuOpen: vi.fn(),
      setIsPstoShowMenuOpen: vi.fn(),
      setIsWeldingJournalShowMenuOpen: vi.fn(),
      setMessage: vi.fn(),
    }))

    act(() => { void result.current.openWeldingJournalWaitingWeldReport() })
    expect(windowMocks.reserveTabularReportWindow).toHaveBeenCalledTimes(1)
    expect(loadWeldingJournalRows).toHaveBeenCalledTimes(1)
    expect(reportWindowMocks.openWeldingJournalWaitingWeldReportWindow).not.toHaveBeenCalled()

    const rows = [{ id: 501, joint: 'F501' }] as WeldInput[]
    await act(async () => { resolveRows(rows) })
    await waitFor(() => expect(reportWindowMocks.openWeldingJournalWaitingWeldReportWindow)
      .toHaveBeenCalledWith(rows, targetWindow))
  })

  it('does not truncate a special LNK report to the modal candidate page', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ id: index + 1, joint: `F${index + 1}` })) as WeldRow[]
    const loadLnkRows = vi.fn(async () => rows)
    const { result } = renderHook(() => useReportOutputActions({
      activeReport: 'lnk',
      activeTitle: 'ЛНК',
      loadLnkRows,
      loadPstoRows: vi.fn(async () => []),
      loadWeldingJournalRows: vi.fn(async () => []),
      setIsLnkShowMenuOpen: vi.fn(),
      setIsPstoShowMenuOpen: vi.fn(),
      setIsWeldingJournalShowMenuOpen: vi.fn(),
      setMessage: vi.fn(),
    }))

    await act(async () => { await result.current.openLnkToRequestReport() })

    expect(reportWindowMocks.openLnkToRequestReportWindow).toHaveBeenCalledWith(rows, targetWindow)
    expect(loadLnkRows).toHaveBeenCalledWith('waitingRequest')
  })
})
