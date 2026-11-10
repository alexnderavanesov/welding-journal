import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SchemeAnnotation } from '@/lib/line-schemes'
import type { PdfCamera } from '@/lib/line-scheme-pdf-camera'
import type { SchemeObjectMenuHandler } from '@/lib/line-scheme-interaction'
import { SCHEME_POINT_PREVIEW } from '@/lib/line-scheme-dimensions'
import { AnnotationShape } from './line-scheme-annotation-shape'
import { LineSchemeNote } from './line-scheme-note'

export const LineSchemeAnnotationMarker = memo(function LineSchemeAnnotationMarker({ item, camera, selected, editable, measuring, onSelect, onMove, onMenu }: {
  item: SchemeAnnotation; camera: PdfCamera; selected: boolean; editable: boolean; measuring: boolean;
  onSelect: (item: SchemeAnnotation, additive?: boolean) => void; onMenu: SchemeObjectMenuHandler; onMove: (item: SchemeAnnotation) => void;
}) {
  const element = useRef<HTMLButtonElement>(null), frame = useRef<number | null>(null), suppress = useRef(false)
  const [hovered, setHovered] = useState(false), note = item.note?.trim()
  const drag = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null)
  useLayoutEffect(() => element.current ? camera.trackMarker(element.current, item) : undefined, [camera, item.x, item.y])
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const preview = (x: number, y: number) => { if (element.current) { camera.moveMarker(element.current, { x, y }); element.current.dispatchEvent(new CustomEvent(SCHEME_POINT_PREVIEW, { bubbles: true, detail: { id: `a:${item.id}`, x, y } })) } }
  const reset = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; drag.current = null; preview(item.x, item.y) }
  return <button ref={element} type="button" data-scheme-annotation={item.id} aria-label={`Обозначение ${item.label}`} aria-pressed={selected}
    onPointerEnter={() => { if (note) setHovered(true) }} onPointerLeave={() => setHovered(false)} onBlur={() => setHovered(false)}
    className="line-scheme-annotation" style={{ width: item.size, height: item.size, transform: camera.markerTransform(item), cursor: measuring ? 'crosshair' : editable ? 'move' : 'pointer', outline: selected ? '2px solid #38bdf8' : undefined }}
    onPointerDown={event => { setHovered(false); event.stopPropagation(); camera.stop(); if (!editable || measuring || event.button !== 0 || event.ctrlKey || event.metaKey) return; event.currentTarget.focus({ preventScroll: true }); onSelect(item); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { startX: event.clientX, startY: event.clientY, x: item.x, y: item.y, moved: false } }}
    onPointerMove={event => { const d = drag.current; if (!d) return; event.stopPropagation(); if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) > 4) d.moved = true; if (!d.moved) return; const p = camera.toPoint(event.clientX, event.clientY); d.x = Math.max(0, Math.min(1, p.x)); d.y = Math.max(0, Math.min(1, p.y)); if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (drag.current) preview(drag.current.x, drag.current.y) }) }}
    onPointerUp={event => { event.stopPropagation(); const d = drag.current; if (!d) return; suppress.current = d.moved; reset(); if (d.moved && editable) onMove({ ...item, x: d.x, y: d.y }) }}
    onPointerCancel={() => { suppress.current = true; reset() }}
    onClick={event => { event.stopPropagation(); if (suppress.current) { suppress.current = false; return }; event.currentTarget.focus({ preventScroll: true }); onSelect(item, event.ctrlKey || event.metaKey) }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onMenu('annotation', item.id, event) }}
    onKeyDown={event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); onMenu('annotation', item.id, event) } }}>
    <AnnotationShape item={item} /><span className="line-scheme-annotation-label" style={{ left: item.size + 4 }}>{item.label}</span>
    {hovered && note && element.current && <LineSchemeNote text={note} anchor={element.current} onClose={() => setHovered(false)} />}
  </button>
})
