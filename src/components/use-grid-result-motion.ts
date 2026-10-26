import { useCallback, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import './grid-result-motion.css'

/** A short reveal of committed results. Never delays data, blocks input, or
 * animates a loading/scroll block. Callers decide when a query has completed. */
export function useGridResultMotion(frame: RefObject<HTMLElement | null>, options: { duration?: number; opacity?: number; ready?: boolean } = {}) {
  const duration = options.duration ?? 150, opacity = options.opacity ?? .84
  const scheduled = useRef(0), animation = useRef<Animation | null>(null)
  const ready = useRef(options.ready ?? true), pending = useRef(false)
  const cancel = useCallback(() => {
    pending.current = false
    cancelAnimationFrame(scheduled.current); scheduled.current = 0
    animation.current?.cancel(); animation.current = null
    frame.current?.removeAttribute('data-grid-result-revealing')
  }, [])
  useLayoutEffect(() => {
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    const changed = () => { if (media?.matches) cancel() }
    media?.addEventListener('change', changed)
    return () => { media?.removeEventListener('change', changed); cancel() }
  }, [cancel])
  const reveal = useCallback(() => {
    cancel()
    if (!ready.current) { pending.current = true; return }
    scheduled.current = requestAnimationFrame(() => {
      scheduled.current = 0
      if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const body = frame.current?.querySelector<HTMLElement>('.ag-grid-scrolling-container')
      if (!body?.isConnected || body.closest('[hidden]') || typeof body.animate !== 'function') return
      const next = body.animate([{ opacity }, { opacity: 1 }], { duration, easing: 'ease-out' })
      if (frame.current?.closest('.journal-server-section')) frame.current.setAttribute('data-grid-result-revealing', '')
      animation.current = next
      next.onfinish = () => { if (animation.current === next) { animation.current = null; frame.current?.removeAttribute('data-grid-result-revealing') } }
    })
  }, [frame, duration, opacity, cancel])
  useLayoutEffect(() => {
    // AG's committed cells can precede React's ready state by a frame. Wait for
    // that commit without polling or animating a still-disabled report.
    ready.current = options.ready ?? true
    if (!ready.current) cancel()
    else if (pending.current) reveal()
  }, [options.ready, cancel, reveal])
  return useMemo(() => ({ reveal, cancel }), [reveal, cancel])
}
