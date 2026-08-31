import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useReportNavigationContext } from '@/lib/use-report-navigation-context'
import type { ActiveReport } from '@/lib/home-state'

describe('useReportNavigationContext', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('restores the source report filters and selected rows', () => {
    const setActiveReport = vi.fn()
    const setColumnFilters = vi.fn()
    const setSelectedWeldingJournalIds = vi.fn()
    const { result, rerender } = renderHook(({ activeReport }: { activeReport: ActiveReport }) => useReportNavigationContext({
      activeReport,
      columnFilters: { line: '330-D01', projectTitle: 'Риформинг' },
      heatTreatmentFilters: {},
      lnkFilters: {},
      selectedWeldingJournalIds: new Set([12, 14]),
      selectedHeatTreatmentIds: new Set(),
      selectedLnkIds: new Set(),
      setActiveReport,
      setColumnFilters,
      setHeatTreatmentFilters: vi.fn(),
      setLnkFilters: vi.fn(),
      setSelectedWeldingJournalIds,
      setSelectedHeatTreatmentIds: vi.fn(),
      setSelectedLnkIds: vi.fn(),
    }), { initialProps: { activeReport: 'weldingJournal' as ActiveReport } })

    act(() => result.current.captureReportContext('lnk'))
    expect(result.current.reportReturnContext).toEqual({ report: 'weldingJournal', title: 'Сварочный журнал' })

    rerender({ activeReport: 'lnk' })
    act(() => result.current.restoreReportContext())
    expect(setActiveReport).toHaveBeenCalledWith('weldingJournal')
    expect(setColumnFilters).toHaveBeenCalledWith({ line: '330-D01', projectTitle: 'Риформинг' })
    expect(setSelectedWeldingJournalIds).toHaveBeenCalledWith(new Set([12, 14]))
    expect(result.current.reportReturnContext).toBeNull()

    rerender({ activeReport: 'weldingJournal' })
    act(() => vi.runAllTimers())
    expect(window.scrollTo).toHaveBeenCalled()
  })

  it('keeps the original source during several linked transitions', () => {
    const { result } = renderHook(() => useReportNavigationContext({
      activeReport: 'documents',
      columnFilters: {},
      heatTreatmentFilters: {},
      lnkFilters: {},
      selectedWeldingJournalIds: new Set(),
      selectedHeatTreatmentIds: new Set(),
      selectedLnkIds: new Set(),
      setActiveReport: vi.fn(),
      setColumnFilters: vi.fn(),
      setHeatTreatmentFilters: vi.fn(),
      setLnkFilters: vi.fn(),
      setSelectedWeldingJournalIds: vi.fn(),
      setSelectedHeatTreatmentIds: vi.fn(),
      setSelectedLnkIds: vi.fn(),
    }))

    act(() => {
      result.current.captureReportContext('lnk')
      result.current.captureReportContext('heatTreatment')
    })

    expect(result.current.reportReturnContext).toEqual({ report: 'documents', title: 'Документы' })
  })

  it('restores scrolling when a linked transition has already returned to the source report type', () => {
    const setLnkFilters = vi.fn()
    const { result, rerender } = renderHook(({ activeReport }: { activeReport: ActiveReport }) => useReportNavigationContext({
      activeReport,
      columnFilters: {},
      heatTreatmentFilters: {},
      lnkFilters: { line: '330-D01' },
      selectedWeldingJournalIds: new Set(),
      selectedHeatTreatmentIds: new Set(),
      selectedLnkIds: new Set([21]),
      setActiveReport: vi.fn(),
      setColumnFilters: vi.fn(),
      setHeatTreatmentFilters: vi.fn(),
      setLnkFilters,
      setSelectedWeldingJournalIds: vi.fn(),
      setSelectedHeatTreatmentIds: vi.fn(),
      setSelectedLnkIds: vi.fn(),
    }), { initialProps: { activeReport: 'lnk' as ActiveReport } })

    act(() => result.current.captureReportContext('documents'))
    rerender({ activeReport: 'documents' })
    rerender({ activeReport: 'lnk' })
    act(() => result.current.restoreReportContext())
    act(() => vi.runAllTimers())

    expect(setLnkFilters).toHaveBeenCalledWith({ line: '330-D01' })
    expect(window.scrollTo).toHaveBeenCalled()
  })

  it('cancels a pending scroll restore when the return route is dismissed', () => {
    const { result, rerender } = renderHook(({ activeReport }: { activeReport: ActiveReport }) => useReportNavigationContext({
      activeReport,
      columnFilters: {},
      heatTreatmentFilters: {},
      lnkFilters: {},
      selectedWeldingJournalIds: new Set(),
      selectedHeatTreatmentIds: new Set(),
      selectedLnkIds: new Set(),
      setActiveReport: vi.fn(),
      setColumnFilters: vi.fn(),
      setHeatTreatmentFilters: vi.fn(),
      setLnkFilters: vi.fn(),
      setSelectedWeldingJournalIds: vi.fn(),
      setSelectedHeatTreatmentIds: vi.fn(),
      setSelectedLnkIds: vi.fn(),
    }), { initialProps: { activeReport: 'lnk' as ActiveReport } })

    act(() => result.current.captureReportContext('documents'))
    rerender({ activeReport: 'documents' })
    act(() => result.current.restoreReportContext())
    act(() => result.current.clearReportContext())
    rerender({ activeReport: 'lnk' })
    act(() => vi.runAllTimers())

    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})
