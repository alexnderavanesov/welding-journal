import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActiveReport } from '@/lib/home-state'
import { useReportNavigationContext } from '@/lib/use-report-navigation-context'
import type { WeldFilters } from '@/server/weld-contracts'

type HookProps = {
  activeReport: ActiveReport
  columnFilters: WeldFilters
  heatTreatmentFilters: WeldFilters
  lnkFilters: WeldFilters
  selectedWeldingJournalIds: Set<number>
  selectedHeatTreatmentIds: Set<number>
  selectedLnkIds: Set<number>
}

function createHookProps(activeReport: ActiveReport, overrides: Partial<HookProps> = {}): HookProps {
  return {
    activeReport,
    columnFilters: {},
    heatTreatmentFilters: {},
    lnkFilters: {},
    selectedWeldingJournalIds: new Set(),
    selectedHeatTreatmentIds: new Set(),
    selectedLnkIds: new Set(),
    ...overrides,
  }
}

describe('useReportNavigationContext', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.history.replaceState({}, '', '/journal')
    Object.defineProperties(window, {
      scrollX: { configurable: true, value: 0 },
      scrollY: { configurable: true, value: 0 },
    })
    document.documentElement.scrollLeft = 0
    document.documentElement.scrollTop = 0
    document.body.scrollLeft = 0
    document.body.scrollTop = 0
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('restores report filters, selection, and scroll on browser Back and Forward entries', () => {
    const setters = {
      setColumnFilters: vi.fn(),
      setHeatTreatmentFilters: vi.fn(),
      setLnkFilters: vi.fn(),
      setSelectedWeldingJournalIds: vi.fn(),
      setSelectedHeatTreatmentIds: vi.fn(),
      setSelectedLnkIds: vi.fn(),
    }
    const journalProps = createHookProps('weldingJournal', {
      columnFilters: { line: '330-D01', projectTitle: 'Риформинг' },
      selectedWeldingJournalIds: new Set([12, 14]),
    })
    Object.defineProperties(window, {
      scrollX: { configurable: true, value: 84 },
      scrollY: { configurable: true, value: 420 },
    })
    const { result, rerender } = renderHook(
      (props: HookProps) => useReportNavigationContext({ ...props, ...setters }),
      { initialProps: journalProps },
    )

    act(() => result.current.captureReportContext('lnk'))
    const journalHistoryState = window.history.state

    Object.defineProperties(window, {
      scrollX: { configurable: true, value: 0 },
      scrollY: { configurable: true, value: 0 },
    })
    act(() => window.history.pushState({}, '', '/lnk'))
    const lnkProps = createHookProps('lnk', {
      lnkFilters: { line: '330-D02' },
      selectedLnkIds: new Set([21]),
    })
    rerender(lnkProps)
    act(() => vi.runAllTimers())
    const lnkHistoryState = window.history.state
    vi.clearAllMocks()

    act(() => window.history.replaceState(journalHistoryState, '', '/journal'))
    rerender(createHookProps('weldingJournal'))
    act(() => vi.runAllTimers())

    expect(setters.setColumnFilters).toHaveBeenCalledWith({ line: '330-D01', projectTitle: 'Риформинг' })
    expect(setters.setSelectedWeldingJournalIds).toHaveBeenCalledWith(new Set([12, 14]))
    expect(window.scrollTo).toHaveBeenCalledWith({ left: 84, top: 420, behavior: 'auto' })

    vi.clearAllMocks()
    act(() => window.history.replaceState(lnkHistoryState, '', '/lnk'))
    rerender(createHookProps('lnk'))
    act(() => vi.runAllTimers())

    expect(setters.setLnkFilters).toHaveBeenCalledWith({ line: '330-D02' })
    expect(setters.setSelectedLnkIds).toHaveBeenCalledWith(new Set([21]))
  })

  it('does not restore a copied snapshot that belongs to another report', () => {
    const setters = {
      setColumnFilters: vi.fn(),
      setHeatTreatmentFilters: vi.fn(),
      setLnkFilters: vi.fn(),
      setSelectedWeldingJournalIds: vi.fn(),
      setSelectedHeatTreatmentIds: vi.fn(),
      setSelectedLnkIds: vi.fn(),
    }
    const { result, rerender } = renderHook(
      (props: HookProps) => useReportNavigationContext({ ...props, ...setters }),
      {
        initialProps: createHookProps('weldingJournal', {
          columnFilters: { line: 'source-line' },
          selectedWeldingJournalIds: new Set([5]),
        }),
      },
    )

    act(() => result.current.captureReportContext('lnk'))
    const copiedSourceState = window.history.state
    vi.clearAllMocks()

    act(() => window.history.pushState(copiedSourceState, '', '/lnk'))
    rerender(createHookProps('lnk', {
      lnkFilters: { line: 'target-line' },
      selectedLnkIds: new Set([8]),
    }))

    expect(setters.setColumnFilters).not.toHaveBeenCalled()
    expect(setters.setLnkFilters).not.toHaveBeenCalled()

    const targetHistoryState = window.history.state
    act(() => window.history.pushState({}, '', '/documents'))
    rerender(createHookProps('documents'))
    vi.clearAllMocks()

    act(() => window.history.replaceState(targetHistoryState, '', '/lnk'))
    rerender(createHookProps('lnk'))
    act(() => vi.runAllTimers())

    expect(setters.setLnkFilters).toHaveBeenCalledWith({ line: 'target-line' })
    expect(setters.setSelectedLnkIds).toHaveBeenCalledWith(new Set([8]))
  })

  it('keeps the latest filters and selection in the current browser entry', () => {
    const setters = {
      setColumnFilters: vi.fn(),
      setHeatTreatmentFilters: vi.fn(),
      setLnkFilters: vi.fn(),
      setSelectedWeldingJournalIds: vi.fn(),
      setSelectedHeatTreatmentIds: vi.fn(),
      setSelectedLnkIds: vi.fn(),
    }
    const { rerender } = renderHook(
      (props: HookProps) => useReportNavigationContext({ ...props, ...setters }),
      {
        initialProps: createHookProps('heatTreatment', {
          heatTreatmentFilters: { line: 'old-line' },
          selectedHeatTreatmentIds: new Set([31]),
        }),
      },
    )

    rerender(createHookProps('heatTreatment', {
      heatTreatmentFilters: { line: 'new-line' },
      selectedHeatTreatmentIds: new Set([32, 33]),
    }))
    const updatedHistoryState = window.history.state

    act(() => window.history.pushState({}, '', '/documents'))
    rerender(createHookProps('documents'))
    vi.clearAllMocks()

    act(() => window.history.replaceState(updatedHistoryState, '', '/psto'))
    rerender(createHookProps('heatTreatment'))
    act(() => vi.runAllTimers())

    expect(setters.setHeatTreatmentFilters).toHaveBeenCalledWith({ line: 'new-line' })
    expect(setters.setSelectedHeatTreatmentIds).toHaveBeenCalledWith(new Set([32, 33]))
  })

  it('restores legacy status filters from browser history as officiality', () => {
    const setters = {
      setColumnFilters: vi.fn(),
      setHeatTreatmentFilters: vi.fn(),
      setLnkFilters: vi.fn(),
      setSelectedWeldingJournalIds: vi.fn(),
      setSelectedHeatTreatmentIds: vi.fn(),
      setSelectedLnkIds: vi.fn(),
    }
    window.history.replaceState({
      __weldingReportContext: {
        version: 1,
        report: 'lnk',
        filters: { status: 'неофициальный', line: '330-D03' },
        selectedRowIds: [41],
        scrollPosition: { left: 0, top: 0 },
      },
    }, '', '/lnk')

    renderHook(() => useReportNavigationContext({
      ...createHookProps('lnk'),
      ...setters,
    }))
    act(() => vi.runAllTimers())

    expect(setters.setLnkFilters).toHaveBeenCalledWith({
      officiality: 'неофициальный',
      line: '330-D03',
    })
    expect(setters.setSelectedLnkIds).toHaveBeenCalledWith(new Set([41]))
  })
})
