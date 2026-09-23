import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { getActiveReportFromPath } from '@/lib/app-report-routes'
import type { ActiveReport } from '@/lib/home-state'
import { getPageScrollPosition, restorePageScrollPosition, type PageScrollPosition } from '@/lib/page-scroll-position'
import { migrateLegacyWeldFieldRecordKeys } from '@/lib/weld-fields'
import type { WeldFilters } from '@/server/weld-contracts'

const REPORT_NAVIGATION_HISTORY_KEY = '__weldingReportContext'
const REPORT_NAVIGATION_HISTORY_VERSION = 1
const SCROLL_POSITION_PERSIST_DELAY_MS = 250
const SNAPSHOT_STORAGE_PREFIX = 'welding-report-navigation:v1:'
const SNAPSHOT_STORAGE_INDEX = `${SNAPSHOT_STORAGE_PREFIX}entries`
const MAX_SAVED_ENTRIES = 50

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

  useLayoutEffect(() => {
    currentReportStateRef.current = {
      activeReport,
      columnFilters,
      heatTreatmentFilters,
      lnkFilters,
      selectedWeldingJournalIds,
      selectedHeatTreatmentIds,
      selectedLnkIds,
    }
  })

  const persistCurrentReportContext = useCallback(() => {
    const state = currentReportStateRef.current
    // The router can render the target before its queued browser-history push.
    // Never overwrite the source entry with that intermediate target state.
    if (getActiveReportFromPath(window.location.pathname) !== state.activeReport) return
    saveReportNavigationSnapshot(buildReportNavigationSnapshot(state))
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
    const snapshot = readReportNavigationSnapshot()
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

function getSnapshotStorageKey() {
  const state: unknown = window.history.state
  if (!isRecord(state)) return null
  const entryKey = state.__TSR_key ?? state.key
  return typeof entryKey === 'string' ? `${SNAPSHOT_STORAGE_PREFIX}${entryKey}` : null
}

function saveReportNavigationSnapshot(snapshot: ReportNavigationSnapshot) {
  const key = getSnapshotStorageKey()
  if (!key) return
  try {
    // Do not call history.replaceState here: TanStack subscribes to it and
    // starts another route load, even if only selection/scroll changed.
    const storage = window.sessionStorage
    const rawIndex: unknown = JSON.parse(storage.getItem(SNAPSHOT_STORAGE_INDEX) ?? '[]')
    const entries = Array.isArray(rawIndex)
      ? rawIndex.filter((entry): entry is string => typeof entry === 'string' && entry.startsWith(SNAPSHOT_STORAGE_PREFIX))
      : []
    const nextEntries = [...new Set(entries.filter((entry) => entry !== key)), key]
    while (nextEntries.length > MAX_SAVED_ENTRIES) storage.removeItem(nextEntries.shift()!)
    storage.setItem(key, JSON.stringify(snapshot))
    storage.setItem(SNAPSHOT_STORAGE_INDEX, JSON.stringify(nextEntries))
  } catch {
    // Navigation remains available if session storage is blocked or full.
  }
}

function readReportNavigationSnapshot() {
  const key = getSnapshotStorageKey()
  try {
    const value = key ? window.sessionStorage.getItem(key) : null
    if (value) return getReportNavigationSnapshot({ [REPORT_NAVIGATION_HISTORY_KEY]: JSON.parse(value) })
  } catch {
    // A corrupt/blocked browser cache must not prevent opening a report.
  }
  // Read old entries once; all new writes are isolated from router history.
  return getReportNavigationSnapshot(window.history.state)
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
