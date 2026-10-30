import {
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { lazy, Suspense, useCallback, useEffect } from 'react'
import { AppRouteError } from '@/components/app-route-error'
import { getActiveReportFromPath, getAppReportPath } from '@/lib/app-report-routes'
import { getJournalSelectionTokenFromUrl } from '@/lib/journal-selection-handoff'
import {
  clearChunkReloadAttempt,
} from '@/lib/chunk-load-recovery'

const HomePage = lazy(() => import('@/components/home-page').then((module) => ({ default: module.HomePage })))

export const Route = createFileRoute('/_app')({
  component: AppRoute,
  errorComponent: AppRouteError,
  pendingComponent: AppRouteLoading,
  ssr: false,
})

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
    <>
      <Suspense fallback={<AppRouteLoading />}>
        <HomePage
          activeReport={activeReport}
          journalSelectionToken={activeReport === 'weldingJournal' ? getJournalSelectionTokenFromUrl(href) : undefined}
          onActiveReportChange={changeActiveReport}
        />
      </Suspense>
    </>
  )
}

export function AppRouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="rounded-md border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-600 shadow-sm">
        Загружаем систему...
      </div>
    </div>
  )
}
