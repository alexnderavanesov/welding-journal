type ZoomPoint = { clientX: number; clientY: number }
type Gesture = Event & ZoomPoint & { scale: number }

/** Local preview gestures only. Ordinary wheel events retain native scrolling. */
export function attachPreviewZoom(target: HTMLElement, options: {
  min: number; max: number; getScale: () => number
  onZoom: (scale: number, point: ZoomPoint) => void
}) {
  const win = target.ownerDocument.defaultView
  if (!win) return () => {}
  let raf = 0, pending: { scale: number; point: ZoomPoint } | null = null, gestureBase: number | null = null
  const current = () => pending?.scale ?? options.getScale()
  const schedule = (scale: number, point: ZoomPoint) => {
    if (!Number.isFinite(scale)) return
    pending = { scale: Math.round(Math.max(options.min, Math.min(options.max, scale)) * 100) / 100, point }
    if (!raf) raf = win.requestAnimationFrame(() => {
      raf = 0
      const next = pending
      pending = null
      if (next) options.onZoom(next.scale, next.point)
    })
  }
  const wheel = (event: Event) => {
    const e = event as WheelEvent
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    if (gestureBase !== null) return // Safari may also emit wheel during a gesture.
    const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? win.innerHeight : 1)
    schedule(current() * Math.exp(Math.max(-1, Math.min(1, -pixels * .002))), e)
  }
  const start = (event: Event) => { event.preventDefault(); gestureBase = current() }
  const change = (event: Event) => {
    if (gestureBase === null) return
    event.preventDefault()
    const e = event as Gesture
    if (e.scale > 0) schedule(gestureBase * e.scale, e)
  }
  const end = (event: Event) => { if (gestureBase !== null) event.preventDefault(); gestureBase = null }
  const listeners = { wheel, gesturestart: start, gesturechange: change, gestureend: end }
  for (const [type, listener] of Object.entries(listeners)) target.addEventListener(type, listener, { passive: false })
  return () => {
    win.cancelAnimationFrame(raf)
    for (const [type, listener] of Object.entries(listeners)) target.removeEventListener(type, listener)
  }
}

/** Preserve the point under the pointer, allowing native scroll limits at edges. */
export function previewZoomAnchor(paper: HTMLElement, point: ZoomPoint, ratio: number) {
  const before = paper.getBoundingClientRect()
  const x = (point.clientX - before.left) * ratio, y = (point.clientY - before.top) * ratio
  return () => {
    const after = paper.getBoundingClientRect()
    return { left: after.left + x - point.clientX, top: after.top + y - point.clientY, behavior: 'instant' as const }
  }
}
