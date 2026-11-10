export type PdfPoint = { x: number; y: number }
export type PdfSize = { width: number; height: number }
export type PdfFit = 'fit-page' | 'fit-width' | 'custom'
export type PdfView = { scale: number; mode: PdfFit; rotation: number }
export const pdfTurn = (rotation: number) => ((rotation % 360) + 360) % 360
export function turnPdfPoint(p: PdfPoint, rotation: number): PdfPoint {
  switch (pdfTurn(rotation)) {
    case 90: return { x: 1 - p.y, y: p.x }
    case 180: return { x: 1 - p.x, y: 1 - p.y }
    case 270: return { x: p.y, y: 1 - p.x }
    default: return p
  }
}
export function unturnPdfPoint(p: PdfPoint, rotation: number) { return turnPdfPoint(p, -rotation) }
export function pdfFootprint(size: PdfSize, rotation: number): PdfSize {
  return pdfTurn(rotation) % 180 ? { width: size.height, height: size.width } : size
}
export function pdfFitScale(size: PdfSize, frame: PdfSize, mode: PdfFit) {
  const width = Math.max(1, frame.width - 48) / size.width
  return Math.max(.01, mode === 'fit-width' ? width : Math.min(width, Math.max(1, frame.height - 48) / size.height))
}

/** Camera changes touch page geometry, not the React point tree. Native scroll
 * pans the already rendered surface; zoom notifications are batched by RAF. */
export function createPdfCamera(stage: HTMLDivElement, space: HTMLDivElement, sheet: HTMLDivElement,
  size: PdfSize, intrinsicRotation: number, onChange: () => void, initial?: PdfView | null) {
  let rotation = pdfTurn(intrinsicRotation + (initial?.rotation ?? 0)), scale = initial?.scale ?? 1, mode: PdfFit = initial?.mode ?? 'fit-page', frame = 0
  let wheelMotion: { target: number; point: PdfPoint; client: PdfPoint } | null = null
  let panMotion: PdfPoint | null = null, translation: PdfPoint = { x: 0, y: 0 }
  const listeners = new Set<() => void>()
  const markers = new Map<HTMLElement, PdfPoint>()
  const markerTransform = (point: PdfPoint) => `translate(calc(${size.width * scale * point.x}px - 50%), calc(${size.height * scale * point.y}px - 50%)) rotate(${-rotation}deg)`
  const paintMarker = (element: HTMLElement, point: PdfPoint) => { element.style.transform = markerTransform(point) }
  let snapshot: PdfView = { scale, rotation, mode }
  const center = () => { const box = stage.getBoundingClientRect(); return { x: box.left + stage.clientWidth / 2, y: box.top + stage.clientHeight / 2 } }
  const toPoint = (clientX: number, clientY: number) => {
    const box = sheet.getBoundingClientRect()
    return unturnPdfPoint({ x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height }, rotation)
  }
  function position(point: PdfPoint, client: PdfPoint) {
    const box = sheet.getBoundingClientRect(), p = turnPdfPoint(point, rotation)
    const x = stage.scrollLeft + box.left + p.x * box.width - client.x
    const y = stage.scrollTop + box.top + p.y * box.height - client.y
    stage.scrollLeft = x; stage.scrollTop = y
    // Scroll positions are rounded to device pixels. Retain the fractional
    // remainder in the sheet transform instead of accumulating wheel jitter.
    translate(stage.scrollLeft - x, stage.scrollTop - y)
  }
  function translate(x: number, y: number) {
    translation = { x, y }; sheet.style.translate = `${x}px ${y}px`
  }
  function layout(anchor?: { point: PdfPoint; client: PdfPoint }) {
    const footprint = pdfFootprint(size, rotation)
    if (mode !== 'custom') scale = pdfFitScale(footprint, { width: stage.clientWidth, height: stage.clientHeight }, mode)
    const w = size.width * scale, h = size.height * scale, view = pdfFootprint({ width: w, height: h }, rotation)
    // A viewport of free margin on each side lets any point remain under the
    // cursor even while the sheet is smaller than the viewport. Tight bounds
    // clamped scroll to zero and pulled the page back toward its centre.
    const left = stage.clientWidth, top = stage.clientHeight
    space.style.width = `${view.width + 2 * left}px`
    space.style.height = `${view.height + 2 * top}px`
    const offsets = rotation === 90 ? [h, 0] : rotation === 180 ? [w, h] : rotation === 270 ? [0, w] : [0, 0]
    sheet.style.width = `${w}px`; sheet.style.height = `${h}px`
    sheet.style.left = `${left}px`; sheet.style.top = `${top}px`
    translate(0, 0)
    sheet.style.transform = `translate(${offsets[0]}px, ${offsets[1]}px) rotate(${rotation}deg)`
    sheet.style.setProperty('--scheme-point-rotation', `${-rotation}deg`)
    // Updating inherited page-size variables invalidated every descendant's
    // computed style. Position only the registered markers, before the single
    // geometry read used to anchor the sheet; no React state or text scaling.
    for (const [element, point] of markers) paintMarker(element, point)
    if (anchor) position(anchor.point, anchor.client)
    else position({ x: .5, y: .5 }, center())
    snapshot = { scale, rotation, mode }; for (const listener of listeners) listener()
    onChange()
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0; wheelMotion = null; panMotion = null
  }
  function zoom(factor: number, client = center()) {
    stop()
    const anchor = { point: toPoint(client.x, client.y), client }
    mode = 'custom'; scale = Math.max(.05, Math.min(8, scale * factor)); layout(anchor)
  }
  function wheel(event: WheelEvent) {
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1
    if (!(event.ctrlKey || event.metaKey)) {
      if (wheelMotion) { cancelAnimationFrame(frame); flushWheel() }
      const xUnit = event.deltaMode === 2 ? stage.clientWidth : unit
      const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * xUnit
      const dy = (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit
      // Use the same frame for pan and zoom: Chrome's default wheel scrolling
      // otherwise commits later than our zoom. OS momentum still arrives as
      // wheel deltas; retain every fraction without adding our own inertia.
      panMotion = { x: (panMotion?.x ?? 0) + dx, y: (panMotion?.y ?? 0) + dy }
      if (!frame) frame = requestAnimationFrame(flushWheel)
      return
    }
    if (panMotion) { cancelAnimationFrame(frame); flushWheel() }
    // Normalize line/page wheels as well as pixel trackpads. Accumulate into
    // the target, so input arriving between paints is applied in full.
    const delta = event.deltaY * unit
    const factor = Math.exp(-Math.max(-120, Math.min(120, delta)) * .006)
    const client = { x: event.clientX, y: event.clientY }
    wheelMotion = { target: Math.max(.05, Math.min(8, (wheelMotion?.target ?? scale) * factor)), point: toPoint(client.x, client.y), client }
    if (!frame) frame = requestAnimationFrame(flushWheel)
  }
  function flushWheel() {
    frame = 0
    if (panMotion) {
      const pan = panMotion; panMotion = null
      const x = Math.max(0, Math.min(stage.scrollWidth - stage.clientWidth, stage.scrollLeft + pan.x - translation.x))
      const y = Math.max(0, Math.min(stage.scrollHeight - stage.clientHeight, stage.scrollTop + pan.y - translation.y))
      stage.scrollLeft = x; stage.scrollTop = y
      translate(stage.scrollLeft - x, stage.scrollTop - y)
      onChange()
      return
    }
    const motion = wheelMotion
    wheelMotion = null
    if (!motion) return
    // Trackpads already provide the intermediate steps. Restarting an easing
    // curve on each event delayed continuous input and moved the sheet after
    // the user's fingers stopped. Commit once at the next paint, with no tail.
    mode = 'custom'; scale = motion.target
    layout(motion)
  }
  stage.addEventListener('wheel', wheel, { passive: false })
  const observer = new ResizeObserver(() => layout(mode === 'custom' ? { point: toPoint(center().x, center().y), client: center() } : undefined))
  observer.observe(stage); layout()
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    toPoint,
    markerTransform,
    trackMarker: (element: HTMLElement, point: PdfPoint) => { markers.set(element, point); paintMarker(element, point); return () => { markers.delete(element) } },
    moveMarker: (element: HTMLElement, point: PdfPoint) => { if (markers.has(element)) markers.set(element, point); paintMarker(element, point) },
    zoom,
    stop,
    fit: (next: PdfFit) => { stop(); mode = next; layout() },
    rotate: () => { stop(); const client = center(), point = toPoint(client.x, client.y); rotation = pdfTurn(rotation + 90); layout(mode === 'custom' ? { point, client } : undefined) },
    reveal: (point: PdfPoint) => { stop(); translate(0, 0); position(point, center()) },
    visible: (overscan = 160) => {
      const box = stage.getBoundingClientRect(), corners = [toPoint(box.left, box.top), toPoint(box.left + stage.clientWidth, box.top + stage.clientHeight)]
      const padX = overscan / (size.width * scale), padY = overscan / (size.height * scale)
      return { left: Math.max(0, Math.min(...corners.map(p => p.x)) - padX), top: Math.max(0, Math.min(...corners.map(p => p.y)) - padY),
        right: Math.min(1, Math.max(...corners.map(p => p.x)) + padX), bottom: Math.min(1, Math.max(...corners.map(p => p.y)) + padY) }
    },
    destroy: () => { observer.disconnect(); stage.removeEventListener('wheel', wheel); stop(); listeners.clear(); markers.clear() },
  }
}
export type PdfCamera = ReturnType<typeof createPdfCamera>
