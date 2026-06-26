import { useState } from 'react'
import type { ActiveReport } from '@/lib/home-state'

export function useReportFilterState() {
  const [activeReport, setActiveReport] = useState<ActiveReport>('weldingJournal')
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
