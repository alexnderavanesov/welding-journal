import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const HomePage = lazy(() => import('@/components/home-page').then((module) => ({ default: module.HomePage })))

export const Route = createFileRoute('/')({
  component: HomeRoute,
})

function HomeRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Загружаем систему...</div>}>
      <HomePage />
    </Suspense>
  )
}
