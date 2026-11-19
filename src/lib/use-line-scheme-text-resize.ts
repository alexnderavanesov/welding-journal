import { useEffect, useRef, type PointerEvent, type RefObject } from 'react'
import type { SchemeAnnotation } from './line-schemes'
import type { PdfCamera, PdfPoint } from './line-scheme-pdf-camera'

export const SCHEME_TEXT_RESIZE_CANCEL = 'scheme-text-resize-cancel'

/** Resize in sheet coordinates, then undo the text's own rotation. No React updates per frame. */
export function useLineSchemeTextResize(item: SchemeAnnotation, camera: PdfCamera, element: RefObject<HTMLButtonElement | null>, enabled: boolean,
  preview: (x: number, y: number) => void, onChange: (item: SchemeAnnotation) => void) {
  const frame = useRef<number | null>(null)
  const drag = useRef<{ start: PdfPoint; point: PdfPoint; width: number; height: number; horizontal: number; vertical: number; moved: boolean; next?: SchemeAnnotation } | null>(null)
  const restore = () => {
    const node = element.current
    if (!node) return
    node.style.width = item.textWidth == null ? '' : `${item.textWidth}px`
    node.style.maxWidth = item.textWidth == null ? '' : 'none'
    node.style.minHeight = item.textHeight == null ? '' : `${item.textHeight}px`
    preview(item.x, item.y)
  }
  const cancel = () => {
    if (!drag.current) return false
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null; drag.current = null
    if (element.current) delete element.current.dataset.schemeTextResizing
    restore(); return true
  }
  useEffect(() => {
    const node = element.current
    if (!enabled || !node) { cancel(); return }
    node.addEventListener(SCHEME_TEXT_RESIZE_CANCEL, cancel)
    return () => { node.removeEventListener(SCHEME_TEXT_RESIZE_CANCEL, cancel); cancel() }
  }, [enabled, item, camera])
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const paint = () => {
    frame.current = null
    const d = drag.current, node = element.current
    if (!d || !node || !d.moved) return
    const angle = item.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
    const dx = (d.point.x - d.start.x) * camera.pageSize.width, dy = (d.point.y - d.start.y) * camera.pageSize.height
    const bound = (value: number) => Math.round(Math.max(24, Math.min(10000, value)) * 1000) / 1000
    const width = bound(d.width + d.horizontal * (dx * cos + dy * sin))
    const height = bound(d.height + d.vertical * (-dx * sin + dy * cos))
    node.style.width = `${width}px`; node.style.maxWidth = 'none'; node.style.minHeight = `${height}px`
    // min-height leaves all wrapped text visible, even if the requested box is too short.
    const actualHeight = Math.max(height, node.offsetHeight)
    const localX = (width - d.width) * d.horizontal / 2, localY = (actualHeight - d.height) * d.vertical / 2
    const clamp = (value: number) => Math.max(0, Math.min(1, value))
    const x = clamp(item.x + (localX * cos - localY * sin) / camera.pageSize.width)
    const y = clamp(item.y + (localX * sin + localY * cos) / camera.pageSize.height)
    d.next = { ...item, x, y, textWidth: width, textHeight: height }
    preview(x, y)
  }
  return {
    cancel,
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      event.stopPropagation(); event.preventDefault()
      if (!enabled || event.button !== 0 || !element.current) return
      camera.stop(); element.current.focus({ preventScroll: true })
      const direction = event.currentTarget.dataset.textResize!
      const point = camera.toPoint(event.clientX, event.clientY)
      drag.current = { start: point, point, width: element.current.offsetWidth, height: element.current.offsetHeight,
        horizontal: direction.includes('e') ? 1 : direction.includes('w') ? -1 : 0,
        vertical: direction.includes('s') ? 1 : direction.includes('n') ? -1 : 0, moved: false }
      element.current.dataset.schemeTextResizing = 'true'
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
      event.stopPropagation()
      const d = drag.current
      if (!d) return
      d.point = camera.toPoint(event.clientX, event.clientY)
      if (Math.hypot((d.point.x - d.start.x) * camera.pageSize.width, (d.point.y - d.start.y) * camera.pageSize.height) > 1) d.moved = true
      if (d.moved && frame.current === null) frame.current = requestAnimationFrame(paint)
    },
    onPointerUp: (event: PointerEvent<HTMLSpanElement>) => {
      event.stopPropagation()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      paint()
      const next = drag.current?.next
      cancel()
      if (enabled && next) onChange(next)
    },
    onPointerCancel: () => { cancel() },
    onLostPointerCapture: () => { cancel() },
  }
}
