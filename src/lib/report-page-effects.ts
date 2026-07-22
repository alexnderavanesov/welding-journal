import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { ActiveReport } from '@/lib/home-state'
import { getActiveColumnFilters, getActiveReportFilterSetter } from '@/lib/report-ui-state'
import { ROW_ID_LIST_FILTER_KEY } from '@/lib/report-navigation'

type ReportFilterSetter = Dispatch<SetStateAction<Record<string, string>>>
type ReportSelectionSetter = Dispatch<SetStateAction<Set<number>>>

type EscapeToClearReportFiltersInput = {
  activeReport: ActiveReport
  editingOpen: boolean
  isReportModalOpen: boolean
  chainOpen: boolean
  selectedWeldingJournalIds: ReadonlySet<number>
  selectedLnkIds: ReadonlySet<number>
  selectedHeatTreatmentIds: ReadonlySet<number>
  columnFilters: Record<string, string>
  heatTreatmentFilters: Record<string, string>
  lnkFilters: Record<string, string>
  setSelectedWeldingJournalIds: ReportSelectionSetter
  setSelectedLnkIds: ReportSelectionSetter
  setSelectedHeatTreatmentIds: ReportSelectionSetter
  setColumnFilters: ReportFilterSetter
  setHeatTreatmentFilters: ReportFilterSetter
  setLnkFilters: ReportFilterSetter
}

export function useEscapeToClearReportFilters({
  activeReport,
  editingOpen,
  isReportModalOpen,
  chainOpen,
  selectedWeldingJournalIds,
  selectedLnkIds,
  selectedHeatTreatmentIds,
  columnFilters,
  heatTreatmentFilters,
  lnkFilters,
  setSelectedWeldingJournalIds,
  setSelectedLnkIds,
  setSelectedHeatTreatmentIds,
  setColumnFilters,
  setHeatTreatmentFilters,
  setLnkFilters,
}: EscapeToClearReportFiltersInput) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || editingOpen || isReportModalOpen || chainOpen) return

      const activeSelection = getActiveReportSelection(activeReport, {
        selectedWeldingJournalIds,
        selectedLnkIds,
        selectedHeatTreatmentIds,
      })
      const clearActiveSelection = getActiveReportSelectionSetter(activeReport, {
        setSelectedWeldingJournalIds,
        setSelectedLnkIds,
        setSelectedHeatTreatmentIds,
      })

      if (activeSelection?.size && clearActiveSelection) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        clearActiveSelection(new Set())
        return
      }

      const activeFilters = getActiveColumnFilters(activeReport, columnFilters, heatTreatmentFilters, lnkFilters)
      if (activeFilters[ROW_ID_LIST_FILTER_KEY]) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        const nextFilters = { ...activeFilters }
        delete nextFilters[ROW_ID_LIST_FILTER_KEY]
        getActiveReportFilterSetter(activeReport, setColumnFilters, setHeatTreatmentFilters, setLnkFilters)(nextFilters)
        return
      }

      event.preventDefault()
      getActiveReportFilterSetter(activeReport, setColumnFilters, setHeatTreatmentFilters, setLnkFilters)({})
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeReport,
    chainOpen,
    columnFilters,
    editingOpen,
    heatTreatmentFilters,
    isReportModalOpen,
    lnkFilters,
    selectedHeatTreatmentIds,
    selectedLnkIds,
    selectedWeldingJournalIds,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
    setSelectedWeldingJournalIds,
  ])
}

function getActiveReportSelection(
  activeReport: ActiveReport,
  selections: {
    selectedWeldingJournalIds: ReadonlySet<number>
    selectedLnkIds: ReadonlySet<number>
    selectedHeatTreatmentIds: ReadonlySet<number>
  },
) {
  if (activeReport === 'lnk') return selections.selectedLnkIds
  if (activeReport === 'heatTreatment') return selections.selectedHeatTreatmentIds
  if (activeReport === 'weldingJournal') return selections.selectedWeldingJournalIds
  return null
}

function getActiveReportSelectionSetter(
  activeReport: ActiveReport,
  setters: {
    setSelectedWeldingJournalIds: ReportSelectionSetter
    setSelectedLnkIds: ReportSelectionSetter
    setSelectedHeatTreatmentIds: ReportSelectionSetter
  },
) {
  if (activeReport === 'lnk') return setters.setSelectedLnkIds
  if (activeReport === 'heatTreatment') return setters.setSelectedHeatTreatmentIds
  if (activeReport === 'weldingJournal') return setters.setSelectedWeldingJournalIds
  return null
}

export function useAutoCollapseNavOnHorizontalScroll(setNavCollapsed: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    function handleHorizontalScroll() {
      if (window.scrollX > 8) {
        setNavCollapsed(true)
      }
    }

    window.addEventListener('scroll', handleHorizontalScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleHorizontalScroll)
  }, [setNavCollapsed])
}

export function useClearTimerOnUnmount(timerRef: { current: ReturnType<typeof setTimeout> | null }) {
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [timerRef])
}
