import type { ReactNode } from 'react'
import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react'

type DocumentTemplateLoadBoundaryProps = {
  children: ReactNode
  error: string | null
  isLoading: boolean
  onRetry: () => void
}

export function DocumentTemplateLoadBoundary({
  children,
  error,
  isLoading,
  onRetry,
}: DocumentTemplateLoadBoundaryProps) {
  if (isLoading) {
    return (
      <div
        role="status"
        className="flex min-h-[420px] items-center justify-center rounded-md border border-slate-300 bg-white px-6 py-12 shadow-sm shadow-slate-200/60"
      >
        <div className="flex max-w-md flex-col items-center text-center">
          <LoaderCircle className="h-7 w-7 animate-spin text-sky-700" />
          <div className="mt-4 text-base font-semibold text-slate-900">Загружаем настройки шаблонов</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Проверяем сохраненные шаблоны и их параметры.
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex min-h-[420px] items-center justify-center rounded-md border border-rose-200 bg-white px-6 py-12 shadow-sm shadow-slate-200/60"
      >
        <div className="flex max-w-lg flex-col items-center text-center">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-rose-50 text-rose-700">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="mt-4 text-base font-semibold text-slate-900">Не удалось загрузить настройки шаблонов</div>
          <p className="mt-1 text-sm leading-6 text-slate-600">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
            Повторить загрузку
          </button>
        </div>
      </div>
    )
  }

  return children
}
