import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import type { ActiveReport } from '@/lib/home-state'
import { getPageScrollPosition, restorePageScrollPosition, type PageScrollPosition } from '@/lib/page-scroll-position'
import { migrateLegacyWeldFieldRecordKeys } from '@/lib/weld-fields'
import type { WeldFilters } from '@/server/weld-contracts'

const REPORT_NAVIGATION_HISTORY_KEY = '__weldingReportContext'
const REPORT_NAVIGATION_HISTORY_VERSION = 1
const SCROLL_POSITION_PERSIST_DELAY_MS = 250

type ReportNavigationSnapshot = {
  version: typeof REPORT_NAVIGATION_HISTORY_VERSION
  report: ActiveReport
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
  setColumnFilters: Dispatch<SetStateAction<WeldFilters>>
  setHeatTreatmentFilters: Dispatch<SetStateAction<WeldFilters>>
  setLnkFilters: Dispatch<SetStateAction<WeldFilters>>
  setSelectedWeldingJournalIds: Dispatch<SetStateAction<Set<number>>>
  setSelectedHeatTreatmentIds: Dispatch<SetStateAction<Set<number>>>
  setSelectedLnkIds: Dispatch<SetStateAction<Set<number>>>
}

type CurrentReportState = Pick<
  UseReportNavigationContextOptions,
  | 'activeReport'
  | 'columnFilters'
  | 'heatTreatmentFilters'
  | 'lnkFilters'
  | 'selectedWeldingJournalIds'
  | 'selectedHeatTreatmentIds'
  | 'selectedLnkIds'
>

export function useReportNavigationContext({
  activeReport,
  columnFilters,
  heatTreatmentFilters,
  lnkFilters,
  selectedWeldingJournalIds,
  selectedHeatTreatmentIds,
  selectedLnkIds,
  setColumnFilters,
  setHeatTreatmentFilters,
  setLnkFilters,
  setSelectedWeldingJournalIds,
  setSelectedHeatTreatmentIds,
  setSelectedLnkIds,
}: UseReportNavigationContextOptions) {
  const [scrollRestoreVersion, setScrollRestoreVersion] = useState(0)
  const currentReportStateRef = useRef<CurrentReportState>({
    activeReport,
    columnFilters,
    heatTreatmentFilters,
    lnkFilters,
    selectedWeldingJournalIds,
    selectedHeatTreatmentIds,
    selectedLnkIds,
  })
  const pendingScrollRestoreRef = useRef<Pick<ReportNavigationSnapshot, 'report' | 'scrollPosition'> | null>(null)
  const skipNextPersistRef = useRef(false)
  const isRestoringRef = useRef(false)

  currentReportStateRef.current = {
    activeReport,
    columnFilters,
    heatTreatmentFilters,
    lnkFilters,
    selectedWeldingJournalIds,
    selectedHeatTreatmentIds,
    selectedLnkIds,
  }

  const persistCurrentReportContext = useCallback(() => {
    replaceReportNavigationSnapshot(buildReportNavigationSnapshot(currentReportStateRef.current))
  }, [])

  useEffect(() => {
    const pending = pendingScrollRestoreRef.current
    if (!pending || pending.report !== activeReport) return
    pendingScrollRestoreRef.current = null
    let settleFrameId: number | null = null
    let finalFrameId: number | null = null
    const timeoutId = window.setTimeout(() => {
      restorePageScrollPosition(pending.scrollPosition)
      settleFrameId = window.requestAnimationFrame(() => {
        finalFrameId = window.requestAnimationFrame(() => {
          isRestoringRef.current = false
          persistCurrentReportContext()
        })
      })
    }, 0)
    return () => {
      window.clearTimeout(timeoutId)
      if (settleFrameId !== null) window.cancelAnimationFrame(settleFrameId)
      if (finalFrameId !== null) window.cancelAnimationFrame(finalFrameId)
    }
  }, [activeReport, persistCurrentReportContext, scrollRestoreVersion])

  useEffect(() => {
    const snapshot = getReportNavigationSnapshot(window.history.state)
    if (!snapshot || snapshot.report !== activeReport) {
      isRestoringRef.current = false
      persistCurrentReportContext()
      return
    }

    isRestoringRef.current = true
    skipNextPersistRef.current = true
    restoreReportSnapshot({
      snapshot,
      setColumnFilters,
      setHeatTreatmentFilters,
      setLnkFilters,
      setSelectedWeldingJournalIds,
      setSelectedHeatTreatmentIds,
      setSelectedLnkIds,
    })
    pendingScrollRestoreRef.current = {
      report: snapshot.report,
      scrollPosition: snapshot.scrollPosition,
    }
    setScrollRestoreVersion((current) => current + 1)
  }, [
    activeReport,
    persistCurrentReportContext,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
    setSelectedWeldingJournalIds,
  ])

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false
      return
    }
    if (!isRestoringRef.current) persistCurrentReportContext()
  }, [
    activeReport,
    columnFilters,
    heatTreatmentFilters,
    lnkFilters,
    persistCurrentReportContext,
    selectedHeatTreatmentIds,
    selectedLnkIds,
    selectedWeldingJournalIds,
  ])

  useEffect(() => {
    let timeoutId: number | null = null
    const persistScrollPosition = () => {
      if (isRestoringRef.current) return
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => {
        timeoutId = null
        persistCurrentReportContext()
      }, SCROLL_POSITION_PERSIST_DELAY_MS)
    }
    const persistBeforeLeaving = () => {
      if (!isRestoringRef.current) persistCurrentReportContext()
    }

    window.addEventListener('scroll', persistScrollPosition, { passive: true })
    window.addEventListener('pagehide', persistBeforeLeaving)
    return () => {
      window.removeEventListener('scroll', persistScrollPosition)
      window.removeEventListener('pagehide', persistBeforeLeaving)
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [persistCurrentReportContext])

  const captureReportContext = useCallback((targetReport: ActiveReport) => {
    if (targetReport === currentReportStateRef.current.activeReport) return
    persistCurrentReportContext()
  }, [persistCurrentReportContext])

  return { captureReportContext }
}

function buildReportNavigationSnapshot(state: CurrentReportState): ReportNavigationSnapshot {
  return {
    version: REPORT_NAVIGATION_HISTORY_VERSION,
    report: state.activeReport,
    filters: { ...getReportFilters(
      state.activeReport,
      state.columnFilters,
      state.heatTreatmentFilters,
      state.lnkFilters,
    ) },
    selectedRowIds: [...getReportSelection(
      state.activeReport,
      state.selectedWeldingJournalIds,
      state.selectedHeatTreatmentIds,
      state.selectedLnkIds,
    )],
    scrollPosition: getPageScrollPosition(),
  }
}

function replaceReportNavigationSnapshot(snapshot: ReportNavigationSnapshot) {
  const currentState = isRecord(window.history.state) ? window.history.state : {}
  try {
    window.history.replaceState({
      ...currentState,
      [REPORT_NAVIGATION_HISTORY_KEY]: snapshot,
    }, '')
  } catch {
    // Report navigation still works if a browser blocks custom history state.
  }
}

function getReportNavigationSnapshot(historyState: unknown): ReportNavigationSnapshot | null {
  if (!isRecord(historyState)) return null
  const value = historyState[REPORT_NAVIGATION_HISTORY_KEY]
  if (!isRecord(value) || value.version !== REPORT_NAVIGATION_HISTORY_VERSION) return null
  if (!isActiveReport(value.report) || !isRecord(value.filters) || !Array.isArray(value.selectedRowIds)) return null
  if (!isRecord(value.scrollPosition)) return null

  const left = Number(value.scrollPosition.left)
  const top = Number(value.scrollPosition.top)
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null

  return {
    version: REPORT_NAVIGATION_HISTORY_VERSION,
    report: value.report,
    filters: migrateLegacyWeldFieldRecordKeys(Object.fromEntries(
      Object.entries(value.filters).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )) as WeldFilters,
    selectedRowIds: Array.from(new Set(
      value.selectedRowIds.map(Number).filter((rowId) => Number.isInteger(rowId) && rowId > 0),
    )),
    scrollPosition: {
      left: Math.max(0, left),
      top: Math.max(0, top),
    },
  }
}

function restoreReportSnapshot({
  snapshot,
  setColumnFilters,
  setHeatTreatmentFilters,
  setLnkFilters,
  setSelectedWeldingJournalIds,
  setSelectedHeatTreatmentIds,
  setSelectedLnkIds,
}: Pick<
  UseReportNavigationContextOptions,
  | 'setColumnFilters'
  | 'setHeatTreatmentFilters'
  | 'setLnkFilters'
  | 'setSelectedWeldingJournalIds'
  | 'setSelectedHeatTreatmentIds'
  | 'setSelectedLnkIds'
> & { snapshot: ReportNavigationSnapshot }) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isActiveReport(value: unknown): value is ActiveReport {
  return value === 'weldingJournal' ||
    value === 'heatTreatment' ||
    value === 'lnk' ||
    value === 'welderStamps' ||
    value === 'percentageLines' ||
    value === 'statistics' ||
    value === 'documents' ||
    value === 'settings' ||
    value === 'userGuide'
}
