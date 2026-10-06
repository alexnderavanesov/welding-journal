import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReportPreviewContent } from '@/lib/tabular-report'

/** A single request per explicit opening/retry. Late completions cannot reopen a closed preview. */
export function useReportPreview(context?: unknown) {
  const [state, setState] = useState<{ busy: boolean; error: string; content: ReportPreviewContent | null } | null>(null)
  const generation = useRef(0), pending = useRef(false)
  const loader = useRef<(() => Promise<ReportPreviewContent>) | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const close = useCallback(() => {
    generation.current++; pending.current = false; loader.current = null; setState(null)
    const target = trigger.current
    requestAnimationFrame(() => { if (target?.isConnected) target.focus() })
  }, [])
  useEffect(() => {
    generation.current++; pending.current = false; loader.current = null; setState(null)
    return () => { generation.current++; pending.current = false; loader.current = null }
  }, [context])
  const run = useCallback(async (load: () => Promise<ReportPreviewContent>) => {
    if (pending.current) return
    pending.current = true
    const request = ++generation.current
    loader.current = load
    setState({ busy: true, error: '', content: null })
    try {
      const content = await load()
      if (request === generation.current) setState({ busy: false, error: '', content })
    } catch (error) {
      if (request === generation.current) setState({ busy: false, content: null,
        error: error instanceof Error ? error.message : 'Не удалось подготовить отчёт. Повторите действие.' })
    } finally { if (request === generation.current) pending.current = false }
  }, [])
  const open = useCallback((load: () => Promise<ReportPreviewContent>) => {
    if (pending.current) return Promise.resolve()
    const active = document.activeElement
    trigger.current = active instanceof HTMLElement
      ? active.closest('[data-report-show-menu]')?.querySelector<HTMLButtonElement>('button') ?? active
      : null
    return run(load)
  }, [run])
  const retry = useCallback(() => { if (loader.current) void run(loader.current) }, [run])
  return { open, previewProps: state ? {
    report: state.content?.report ?? null, onDownloadExcel: state.content?.onDownloadExcel,
    busy: state.busy, error: state.error, onClose: close, onRetry: retry,
  } : null }
}
