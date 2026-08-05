import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const HomePage = lazy(() => import('@/components/home-page').then((module) => ({ default: module.HomePage })))

export const Route = createFileRoute('/')({
  component: HomeRoute,
  pendingComponent: HomeRouteLoading,
  ssr: false,
})

function HomeRoute() {
  return (
    <Suspense fallback={<HomeRouteLoading />}>
      <HomePage />
    </Suspense>
  )
}

export function HomeRouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="rounded-md border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-600 shadow-sm">
        Загружаем систему...
      </div>
    </div>
  )
}
