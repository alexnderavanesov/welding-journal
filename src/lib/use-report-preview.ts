import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReportPreviewContent } from '@/lib/tabular-report'

type PreviewLoader = (signal: AbortSignal) => Promise<ReportPreviewContent>

/** A single request per explicit opening/retry. Late completions cannot reopen a closed preview. */
export function useReportPreview(context?: unknown) {
  const [state, setState] = useState<{ context: unknown; busy: boolean; error: string; content: ReportPreviewContent | null } | null>(null)
  const contextRef = useRef(context)
  contextRef.current = context
  const generation = useRef(0)
  const currentRequest = useRef<AbortController | null>(null)
  const loader = useRef<PreviewLoader | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const cancel = useCallback(() => {
    generation.current++
    currentRequest.current?.abort()
    currentRequest.current = null
    loader.current = null
  }, [])
  const close = useCallback(() => {
    cancel()
    setState(null)
    const target = trigger.current
    const closedAt = generation.current
    requestAnimationFrame(() => {
      // Closing a portal can leave focus on body. A control already focused
      // before this frame owns the next keystroke.
      if (generation.current === closedAt && target?.isConnected && document.activeElement === document.body) {
        target.focus({ preventScroll: true })
      }
    })
  }, [cancel])
  useEffect(() => {
    setState(null)
    return cancel
  }, [context, cancel])
  const run = useCallback(async (load: PreviewLoader) => {
    if (currentRequest.current) return
    const controller = new AbortController()
    currentRequest.current = controller
    const request = ++generation.current
    const requestContext = contextRef.current
    loader.current = load
    setState({ context: requestContext, busy: true, error: '', content: null })
    try {
      const content = await load(controller.signal)
      if (request === generation.current && requestContext === contextRef.current) setState({ context: requestContext, busy: false, error: '', content })
    } catch (error) {
      if (request === generation.current && requestContext === contextRef.current) setState({ context: requestContext, busy: false, content: null,
        error: error instanceof Error ? error.message : 'Не удалось подготовить отчёт. Повторите действие.' })
    } finally { if (request === generation.current) currentRequest.current = null }
  }, [])
  const open = useCallback((load: PreviewLoader) => {
    if (currentRequest.current) return Promise.resolve()
    const active = document.activeElement
    trigger.current = active instanceof HTMLElement
      ? active.closest('[data-report-show-menu]')?.querySelector<HTMLButtonElement>('button') ?? active
      : null
    return run(load)
  }, [run])
  const retry = useCallback(() => { if (loader.current) void run(loader.current) }, [run])
  return { open, previewProps: state && state.context === context ? {
    report: state.content?.report ?? null, onDownloadExcel: state.content?.onDownloadExcel,
    generatedAt: state.content?.report.generatedAt,
    busy: state.busy, error: state.error, onClose: close, onRetry: retry,
  } : null }
}
