import { useEffect } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { retryAppModules } from '@/lib/app-module-retry'
import { isChunkLoadError, markChunkReloadAttempt } from '@/lib/chunk-load-recovery'
import { Button } from './ui/button'

export function AppRouteError({ error, reset }: ErrorComponentProps) {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname
  const chunkError = isChunkLoadError(error)

  useEffect(() => {
    if (!chunkError) return
    if (markChunkReloadAttempt(pathname)) void retryAppModules()
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
          onClick={event => {
            if (chunkError) { event.currentTarget.disabled = true; void retryAppModules() }
            else reset()
          }}
        >
          Повторить
        </Button>
        {chunkError ? <p className="mt-3 text-sm leading-6 text-slate-600">Если после восстановления соединения повтор не помогает, полностью закройте браузер и откройте приложение снова.</p> : null}
      </div>
    </div>
  )
}
