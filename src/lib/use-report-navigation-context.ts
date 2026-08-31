import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import type { ActiveReport } from '@/lib/home-state'
import { getPageScrollPosition, restorePageScrollPosition, type PageScrollPosition } from '@/lib/page-scroll-position'
import { getActiveReportTitle } from '@/lib/report-ui-state'
import type { WeldFilters } from '@/server/weld-contracts'

export type ReportReturnContext = {
  report: ActiveReport
  title: string
}

type ReportNavigationSnapshot = ReportReturnContext & {
  filters: WeldFilters
  selectedRowIds: number[]
  scrollPosition: PageScrollPosition
}

type UseReportNavigationContextOptions = {
  activeReport: ActiveReport
  columnFilters: WeldFilters
  heatTreatmentFilters: WeldFilters
  lnkFilters: WeldFilters
  selectedWeldingJournalIds: ReadonlySet<number>
  selectedHeatTreatmentIds: ReadonlySet<number>
  selectedLnkIds: ReadonlySet<number>
  setActiveReport: Dispatch<SetStateAction<ActiveReport>>
  setColumnFilters: Dispatch<SetStateAction<WeldFilters>>
  setHeatTreatmentFilters: Dispatch<SetStateAction<WeldFilters>>
  setLnkFilters: Dispatch<SetStateAction<WeldFilters>>
  setSelectedWeldingJournalIds: Dispatch<SetStateAction<Set<number>>>
  setSelectedHeatTreatmentIds: Dispatch<SetStateAction<Set<number>>>
  setSelectedLnkIds: Dispatch<SetStateAction<Set<number>>>
}

export function useReportNavigationContext({
  activeReport,
  columnFilters,
  heatTreatmentFilters,
  lnkFilters,
  selectedWeldingJournalIds,
  selectedHeatTreatmentIds,
  selectedLnkIds,
  setActiveReport,
  setColumnFilters,
  setHeatTreatmentFilters,
  setLnkFilters,
  setSelectedWeldingJournalIds,
  setSelectedHeatTreatmentIds,
  setSelectedLnkIds,
}: UseReportNavigationContextOptions) {
  const [snapshot, setSnapshot] = useState<ReportNavigationSnapshot | null>(null)
  const [scrollRestoreVersion, setScrollRestoreVersion] = useState(0)
  const pendingScrollRestoreRef = useRef<Pick<ReportNavigationSnapshot, 'report' | 'scrollPosition'> | null>(null)

  useEffect(() => {
    const pending = pendingScrollRestoreRef.current
    if (!pending || pending.report !== activeReport) return
    pendingScrollRestoreRef.current = null
    const timeoutId = window.setTimeout(() => restorePageScrollPosition(pending.scrollPosition), 0)
    return () => window.clearTimeout(timeoutId)
  }, [activeReport, scrollRestoreVersion])

  const captureReportContext = useCallback((targetReport: ActiveReport) => {
    if (targetReport === activeReport) return
    setSnapshot((current) => current ?? {
      report: activeReport,
      title: getActiveReportTitle(activeReport),
      filters: { ...getReportFilters(activeReport, columnFilters, heatTreatmentFilters, lnkFilters) },
      selectedRowIds: [...getReportSelection(
        activeReport,
        selectedWeldingJournalIds,
        selectedHeatTreatmentIds,
        selectedLnkIds,
      )],
      scrollPosition: getPageScrollPosition(),
    })
  }, [
    activeReport,
    columnFilters,
    heatTreatmentFilters,
    lnkFilters,
    selectedHeatTreatmentIds,
    selectedLnkIds,
    selectedWeldingJournalIds,
  ])

  const clearReportContext = useCallback(() => {
    pendingScrollRestoreRef.current = null
    setSnapshot(null)
    setScrollRestoreVersion((current) => current + 1)
  }, [])

  const restoreReportContext = useCallback(() => {
    if (!snapshot) return
    if (snapshot.report === 'weldingJournal') {
      setColumnFilters(snapshot.filters)
      setSelectedWeldingJournalIds(new Set(snapshot.selectedRowIds))
    } else if (snapshot.report === 'lnk') {
      setLnkFilters(snapshot.filters)
      setSelectedLnkIds(new Set(snapshot.selectedRowIds))
    } else if (snapshot.report === 'heatTreatment') {
      setHeatTreatmentFilters(snapshot.filters)
      setSelectedHeatTreatmentIds(new Set(snapshot.selectedRowIds))
    }
    pendingScrollRestoreRef.current = {
      report: snapshot.report,
      scrollPosition: snapshot.scrollPosition,
    }
    setActiveReport(snapshot.report)
    setSnapshot(null)
    setScrollRestoreVersion((current) => current + 1)
  }, [
    setActiveReport,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
    setSelectedWeldingJournalIds,
    snapshot,
  ])

  return {
    reportReturnContext: snapshot ? { report: snapshot.report, title: snapshot.title } : null,
    captureReportContext,
    clearReportContext,
    restoreReportContext,
  }
}

function getReportFilters(
  report: ActiveReport,
  columnFilters: WeldFilters,
  heatTreatmentFilters: WeldFilters,
  lnkFilters: WeldFilters,
) {
  if (report === 'weldingJournal') return columnFilters
  if (report === 'heatTreatment') return heatTreatmentFilters
  if (report === 'lnk') return lnkFilters
  return {}
}

function getReportSelection(
  report: ActiveReport,
  selectedWeldingJournalIds: ReadonlySet<number>,
  selectedHeatTreatmentIds: ReadonlySet<number>,
  selectedLnkIds: ReadonlySet<number>,
) {
  if (report === 'weldingJournal') return selectedWeldingJournalIds
  if (report === 'heatTreatment') return selectedHeatTreatmentIds
  if (report === 'lnk') return selectedLnkIds
  return new Set<number>()
}
