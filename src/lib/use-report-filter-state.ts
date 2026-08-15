import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'
import type { ActiveReport } from '@/lib/home-state'

type UseReportFilterStateOptions = {
  activeReport?: ActiveReport
  onActiveReportChange?: (report: ActiveReport) => void
}

export function useReportFilterState(options: UseReportFilterStateOptions = {}) {
  const [internalActiveReport, setInternalActiveReport] = useState<ActiveReport>('weldingJournal')
  const activeReport = options.activeReport ?? internalActiveReport
  const setActiveReport = useCallback<Dispatch<SetStateAction<ActiveReport>>>((value) => {
    const nextReport = typeof value === 'function' ? value(activeReport) : value
    if (options.activeReport === undefined) setInternalActiveReport(nextReport)
    if (nextReport !== activeReport) options.onActiveReportChange?.(nextReport)
  }, [activeReport, options.activeReport, options.onActiveReportChange])
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [heatTreatmentFilters, setHeatTreatmentFilters] = useState<Record<string, string>>({})
  const [lnkFilters, setLnkFilters] = useState<Record<string, string>>({})
  const [navCollapsed, setNavCollapsed] = useState(false)

  return {
    activeReport,
    columnFilters,
    heatTreatmentFilters,
    lnkFilters,
    navCollapsed,
    setActiveReport,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
    setNavCollapsed,
  }
}
