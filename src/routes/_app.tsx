import { createFileRoute } from '@tanstack/react-router'
import { AppRouteError } from '@/components/app-route-error'

export const Route = createFileRoute('/_app')({
  errorComponent: AppRouteError,
  pendingComponent: AppRouteLoading,
  pendingMinMs: 0,
  ssr: false,
})

export function AppRouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="rounded-md border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-600 shadow-sm">
        Загружаем систему...
      </div>
    </div>
  )
}
