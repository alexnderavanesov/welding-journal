import {
  createFileRoute,
  type ErrorComponentProps,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { lazy, Suspense, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { getActiveReportFromPath, getAppReportPath } from '@/lib/app-report-routes'
import {
  clearChunkReloadAttempt,
  isChunkLoadError,
  markChunkReloadAttempt,
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
  const navigate = useNavigate()
  const activeReport = getActiveReportFromPath(pathname)
  const changeActiveReport = useCallback((report: Parameters<typeof getAppReportPath>[0]) => {
    void navigate({ to: getAppReportPath(report) })
  }, [navigate])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      clearChunkReloadAttempt(window.sessionStorage, pathname)
    }, 30_000)
    return () => window.clearTimeout(timeoutId)
  }, [pathname])

  return (
    <Suspense fallback={<AppRouteLoading />}>
      <HomePage
        activeReport={activeReport}
        onActiveReportChange={changeActiveReport}
      />
    </Suspense>
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

function AppRouteError({ error, reset }: ErrorComponentProps) {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname
  const chunkError = isChunkLoadError(error)

  useEffect(() => {
    if (!chunkError) return
    if (markChunkReloadAttempt(window.sessionStorage, pathname)) window.location.reload()
  }, [chunkError, pathname])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-lg rounded-md border border-red-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-950">Не удалось открыть раздел</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {chunkError
            ? 'Версия приложения обновилась или браузер не загрузил один из файлов. Обновите страницу.'
            : 'Произошла временная ошибка загрузки. Повторите попытку.'}
        </p>
        <Button
          type="button"
          className="mt-5 w-full"
          onClick={() => {
            if (chunkError) window.location.reload()
            else reset()
          }}
        >
          Повторить
        </Button>
      </div>
    </div>
  )
}
