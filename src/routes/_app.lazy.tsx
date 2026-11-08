import { createLazyFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect } from 'react'
import { HomePage } from '@/components/home-page'
import { getActiveReportFromPath, getAppReportPath } from '@/lib/app-report-routes'
import { getJournalSelectionTokenFromUrl } from '@/lib/journal-selection-handoff'
import { clearChunkReloadAttempt } from '@/lib/chunk-load-recovery'

// The router loads this screen once. A second React.lazy/Suspense around
// HomePage would add another fallback/retry before its data effects can start.
export const Route = createLazyFileRoute('/_app')({ component: AppRoute })

function AppRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const href = useRouterState({ select: (state) => state.location.href })
  const navigate = useNavigate()
  const activeReport = getActiveReportFromPath(pathname)
  const changeActiveReport = useCallback((report: Parameters<typeof getAppReportPath>[0]) => {
    void navigate({ to: getAppReportPath(report) })
  }, [navigate])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      clearChunkReloadAttempt(pathname)
    }, 30_000)
    return () => window.clearTimeout(timeoutId)
  }, [pathname])

  return (
    <HomePage
      activeReport={activeReport}
      journalSelectionToken={activeReport === 'weldingJournal' ? getJournalSelectionTokenFromUrl(href) : undefined}
      onActiveReportChange={changeActiveReport}
    />
  )
}
