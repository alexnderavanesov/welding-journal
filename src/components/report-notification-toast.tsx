import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export type ReportNotificationToastProps = {
  message?: string
  tone?: 'error' | 'info' | 'success'
  onDismiss?: () => void
  durationMs?: number
}

export function ReportNotificationToast({
  message,
  tone = 'info',
  onDismiss,
  durationMs = 10_000,
}: ReportNotificationToastProps) {
  const [isPaused, setIsPaused] = useState(false)
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null)
  const dismiss = useCallback(() => {
    if (!message) return
    setDismissedMessage(message)
    onDismiss?.()
  }, [message, onDismiss])

  useEffect(() => {
    setDismissedMessage(null)
    setIsPaused(false)
  }, [message])

  useEffect(() => {
    if (!message || dismissedMessage === message || isPaused) return undefined

    const timeoutId = window.setTimeout(dismiss, durationMs)
    return () => window.clearTimeout(timeoutId)
  }, [dismiss, dismissedMessage, durationMs, isPaused, message])

  if (!message || dismissedMessage === message) return null

  const isSuccess = tone === 'success'
  const isError = tone === 'error'
  const Icon = isError ? AlertCircle : isSuccess ? CheckCircle2 : Info

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-20 right-4 z-[35] flex w-[calc(100vw-2rem)] max-w-sm items-center gap-2.5 rounded-lg border bg-white/95 p-2.5 pr-2 text-[13px] shadow-[0_12px_30px_rgba(15,23,42,0.16)] backdrop-blur-sm xl:bottom-5 xl:right-20',
        isError
          ? 'border-rose-200 text-rose-950 shadow-rose-100/50'
          : isSuccess
            ? 'border-emerald-200 text-emerald-950 shadow-emerald-100/50'
            : 'border-sky-200 text-slate-800 shadow-sky-100/50',
      )}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          isError
            ? 'bg-rose-50 text-rose-600'
            : isSuccess
              ? 'bg-emerald-50 text-emerald-600'
              : 'bg-sky-50 text-sky-600',
        )}
        aria-hidden="true"
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <span className="max-h-32 min-w-0 flex-1 overflow-y-auto break-words font-medium leading-5">{message}</span>
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
        aria-label="Закрыть уведомление"
        title="Закрыть"
        onClick={dismiss}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
