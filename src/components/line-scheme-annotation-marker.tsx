import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { schemeTextFontSize, type SchemeAnnotation } from '@/lib/line-schemes'
import type { PdfCamera } from '@/lib/line-scheme-pdf-camera'
import type { SchemeObjectMenuHandler } from '@/lib/line-scheme-interaction'
import { SCHEME_POINT_PREVIEW } from '@/lib/line-scheme-dimensions'
import { useLineSchemeTextResize } from '@/lib/use-line-scheme-text-resize'
import { AnnotationShape } from './line-scheme-annotation-shape'
import { LineSchemeNote } from './line-scheme-note'

export const LineSchemeAnnotationMarker = memo(function LineSchemeAnnotationMarker({ item, camera, selected, editable, measuring, onSelect, onMove, onMenu }: {
  item: SchemeAnnotation; camera: PdfCamera; selected: boolean; editable: boolean; measuring: boolean;
  onSelect: (item: SchemeAnnotation, additive?: boolean) => void; onMenu: SchemeObjectMenuHandler; onMove: (item: SchemeAnnotation) => void;
}) {
  const element = useRef<HTMLButtonElement>(null), frame = useRef<number | null>(null), suppress = useRef(false)
  const text = item.shape === 'text'
  const position = { x: item.x, y: item.y, ...(text ? { textRotation: item.rotation } : {}) }
  const [hovered, setHovered] = useState(false), note = item.note?.trim()
  const drag = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null)
  useLayoutEffect(() => element.current ? camera.trackMarker(element.current, position) : undefined, [camera, item.x, item.y, item.rotation, text])
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const preview = (x: number, y: number) => { if (element.current) { camera.moveMarker(element.current, { ...position, x, y }); element.current.dispatchEvent(new CustomEvent(SCHEME_POINT_PREVIEW, { bubbles: true, detail: { id: `a:${item.id}`, x, y } })) } }
  const reset = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; drag.current = null; preview(item.x, item.y) }
  const { cancel: cancelResize, ...resize } = useLineSchemeTextResize(item, camera, element, text && selected && editable && !measuring, preview, onMove)
  return <button ref={element} type="button" data-scheme-annotation={item.id} aria-label={`Обозначение ${item.label}`} aria-pressed={selected}
    onPointerEnter={() => { if (note) setHovered(true) }} onPointerLeave={() => setHovered(false)} onBlur={() => setHovered(false)}
    className={`line-scheme-annotation${text ? " line-scheme-text" : ""}`} style={{ width: text ? item.textWidth ?? undefined : item.size, minHeight: text ? item.textHeight ?? undefined : undefined, maxWidth: text && item.textWidth != null ? 'none' : undefined, height: text ? undefined : item.size, fontSize: text ? schemeTextFontSize(item.size) : undefined, color: text ? item.color : undefined, transform: camera.markerTransform(position), cursor: measuring ? 'crosshair' : editable ? 'move' : 'pointer', outline: selected ? `${text ? 1 : 2}px solid #38bdf8` : undefined }}
    onPointerDown={event => { setHovered(false); event.stopPropagation(); camera.stop(); if (!editable || measuring || event.button !== 0 || event.ctrlKey || event.metaKey) return; event.currentTarget.focus({ preventScroll: true }); onSelect(item); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { startX: event.clientX, startY: event.clientY, x: item.x, y: item.y, moved: false } }}
    onPointerMove={event => { const d = drag.current; if (!d) return; event.stopPropagation(); if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) > 4) d.moved = true; if (!d.moved) return; const p = camera.toPoint(event.clientX, event.clientY); if (text) { const start = camera.toPoint(d.startX, d.startY); p.x += item.x - start.x; p.y += item.y - start.y }; d.x = Math.max(0, Math.min(1, p.x)); d.y = Math.max(0, Math.min(1, p.y)); if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (drag.current) preview(drag.current.x, drag.current.y) }) }}
    onPointerUp={event => { event.stopPropagation(); const d = drag.current; if (!d) return; suppress.current = d.moved; reset(); if (d.moved && editable) onMove({ ...item, x: d.x, y: d.y }) }}
    onPointerCancel={() => { suppress.current = true; reset() }}
    onClick={event => { event.stopPropagation(); if (suppress.current) { suppress.current = false; return }; event.currentTarget.focus({ preventScroll: true }); onSelect(item, event.ctrlKey || event.metaKey) }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onMenu('annotation', item.id, event) }}
    onKeyDown={event => { if (event.key === 'Escape' && cancelResize()) { event.preventDefault(); event.stopPropagation(); return }; if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); onMenu('annotation', item.id, event) } }}>
    {text ? item.label : <><AnnotationShape item={item} /><span className="line-scheme-annotation-label" style={{ left: item.size + 4 }}>{item.label}</span></>}
    {text && selected && editable && !measuring && (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map(direction => <span key={direction} aria-hidden="true" title="Изменить размер текстового блока" data-text-resize={direction} className="line-scheme-text-resize" {...resize} onPointerEnter={event => {
      const angle = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 }[direction] + item.rotation + camera.getSnapshot().rotation
      event.currentTarget.style.cursor = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(angle / 45) % 4]
    }} onClick={event => { event.preventDefault(); event.stopPropagation() }} />)}
    {!text && hovered && note && element.current && <LineSchemeNote text={note} anchor={element.current} onClose={() => setHovered(false)} />}
  </button>
})
