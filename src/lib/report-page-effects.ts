import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { ActiveReport } from '@/lib/home-state'
import { getActiveReportFilterSetter } from '@/lib/report-ui-state'

type ReportFilterSetter = Dispatch<SetStateAction<Record<string, string>>>

type EscapeToClearReportFiltersInput = {
  activeReport: ActiveReport
  editingOpen: boolean
  isReportModalOpen: boolean
  chainOpen: boolean
  setColumnFilters: ReportFilterSetter
  setHeatTreatmentFilters: ReportFilterSetter
  setLnkFilters: ReportFilterSetter
}

export function useEscapeToClearReportFilters({
  activeReport,
  editingOpen,
  isReportModalOpen,
  chainOpen,
  setColumnFilters,
  setHeatTreatmentFilters,
  setLnkFilters,
}: EscapeToClearReportFiltersInput) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || editingOpen || isReportModalOpen || chainOpen) return
      getActiveReportFilterSetter(activeReport, setColumnFilters, setHeatTreatmentFilters, setLnkFilters)({})
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeReport,
    chainOpen,
    editingOpen,
    isReportModalOpen,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
  ])
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
