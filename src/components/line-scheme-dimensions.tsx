import { memo, useLayoutEffect, useRef } from 'react'
import { schemeDimensionEnds, type SchemeDimension, type SchemeAnchor } from '@/lib/line-schemes'
import type { PdfCamera } from '@/lib/line-scheme-pdf-camera'
import { formatSchemeDistance, schemeDimensionGeometry, schemeDimensionStyle, groupSchemeDimensionPaths, SCHEME_DIMENSION_EXTENT, SCHEME_POINT_PREVIEW } from '@/lib/line-scheme-dimensions'
import type { SchemeObjectMenuHandler } from '@/lib/line-scheme-interaction'
import { LineSchemeDimensionInput, type DimensionEditing } from './line-scheme-dimension-input'
type Position = { x: number; y: number }
type Props = { dimensions: SchemeDimension[]; anchors: SchemeAnchor[]; camera: PdfCamera; editable: boolean; editing: DimensionEditing; onMenu: SchemeObjectMenuHandler;
  onEdit: (dimension: SchemeDimension) => void; onMove: (dimension: SchemeDimension) => void }

/** SVG follows the sheet without React work during zoom. Labels use the same
 * precise, counter-rotated positioning as markers. Drag previews update only
 * dimensions connected to the moving point, once per animation frame. */
export const LineSchemeDimensions = memo(function LineSchemeDimensions({ dimensions, anchors, camera, editable, editing, onMenu, onEdit, onMove }: Props) {
  const root = useRef<HTMLDivElement>(null), pointsById = new Map(anchors.map(point => [point.key, point]))
  const geometries = dimensions.flatMap(item => {
    const a = pointsById.get(schemeDimensionEnds(item)[0]), b = pointsById.get(schemeDimensionEnds(item)[1])
    return a && b ? [{ style: schemeDimensionStyle(item), geometry: schemeDimensionGeometry(a, b, item) }] : []
  })
  const groups = groupSchemeDimensionPaths(geometries)
  const paintRef = useRef<(item: SchemeDimension) => void>(() => {})
  useLayoutEffect(() => {
    const element = root.current, parent = element?.parentElement
    if (!element || !parent) return
    const positions = new Map<string, Position>(anchors.map(point => [point.key, point]))
    const connected = new Map<string, SchemeDimension[]>()
    // Two shared paths per bounded style and a linear label lookup bound setup;
    // the connected labels still move directly, without per-frame React state.
    const pathsByStyle = new Map([...element.querySelectorAll<SVGGElement>('[data-dimension-style]')].map(group => [group.dataset.dimensionStyle!, { main: group.querySelector('[data-dimension-main]'), extensions: group.querySelector('[data-dimension-extensions]') }]))
    const labels = new Map([...element.querySelectorAll<HTMLDivElement>('[data-scheme-dimension]')].map(label => [label.dataset.schemeDimension!, label]))
    const paths = new Map(dimensions.flatMap(item => {
      const a = positions.get(schemeDimensionEnds(item)[0]), b = positions.get(schemeDimensionEnds(item)[1])
      return a && b ? [[item.id, { style: schemeDimensionStyle(item), geometry: schemeDimensionGeometry(a, b, item) }] as const] : []
    }))
    for (const item of dimensions) for (const id of schemeDimensionEnds(item)) { const list = connected.get(id) ?? []; list.push(item); connected.set(id, list) }
    const update = (item: SchemeDimension) => {
      const a = positions.get(schemeDimensionEnds(item)[0]), b = positions.get(schemeDimensionEnds(item)[1])
      if (!a || !b) return
      const geometry = schemeDimensionGeometry(a, b, item)
      paths.set(item.id, { style: schemeDimensionStyle(item), geometry })
      const label = labels.get(item.id)
      if (label) camera.moveMarker(label, geometry)
    }
    const paintPaths = () => {
      for (const [key, group] of groupSchemeDimensionPaths(paths.values())) {
        const nodes = pathsByStyle.get(key)
        nodes?.main?.setAttribute('d', group.main.join(' '))
        nodes?.extensions?.setAttribute('d', group.extensions.join(' '))
      }
    }
    paintRef.current = item => { update(item); paintPaths() }
    const preview = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; x: number; y: number }>).detail
      positions.set(detail.id, detail)
      const items = connected.get(detail.id)
      if (!items) return
      for (const item of items) update(item)
      paintPaths()
    }
    parent.addEventListener(SCHEME_POINT_PREVIEW, preview)
    return () => { parent.removeEventListener(SCHEME_POINT_PREVIEW, preview); paintRef.current = () => {} }
  }, [dimensions, anchors, camera, editing.item?.id, editing.surface])
  return <div ref={root} className="line-scheme-dimensions">
    <svg width="100%" height="100%" viewBox={`0 0 ${SCHEME_DIMENSION_EXTENT} ${SCHEME_DIMENSION_EXTENT}`} preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 overflow-visible">
      {[...groups].map(([key, group]) => <g key={key} data-dimension-style={key} fill="none" stroke={group.color}>
        <path data-dimension-extensions d={group.extensions.join(' ')} vectorEffect="non-scaling-stroke" strokeWidth={Math.max(1, group.strokeWidth - .5)} strokeDasharray="3 3" />
        <path data-dimension-main d={group.main.join(' ')} vectorEffect="non-scaling-stroke" strokeWidth={group.strokeWidth} />
      </g>)}
    </svg>
    {dimensions.map(item => {
      const a = pointsById.get(schemeDimensionEnds(item)[0]), b = pointsById.get(schemeDimensionEnds(item)[1])
      return a && b ? <DimensionLabel key={item.id} item={item} a={a} b={b} camera={camera} editable={editable} editing={editing}
        onMenu={onMenu} onEdit={onEdit} onMove={onMove} onPreview={item => paintRef.current(item)} /> : null
    })}
  </div>
})

function DimensionLabel({ item, a, b, camera, editable, editing, onMenu, onEdit, onMove, onPreview }: {
  item: SchemeDimension; a: SchemeAnchor; b: SchemeAnchor; camera: PdfCamera; editable: boolean; editing: DimensionEditing; onMenu: SchemeObjectMenuHandler;
  onEdit: Props['onEdit']; onMove: Props['onMove']; onPreview: (item: SchemeDimension) => void;
}) {
  const drag = useRef<{ x: number; y: number; next: SchemeDimension; moved: boolean } | null>(null)
  const frame = useRef<number | null>(null), suppress = useRef(false)
  const element = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const geometry = schemeDimensionGeometry(a, b, item)
  useLayoutEffect(() => element.current ? camera.trackMarker(element.current, geometry) : undefined, [camera, geometry.x, geometry.y])
  const reset = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; drag.current = null; onPreview(item) }
  const isEditing = editing.item?.id === item.id && editing.surface === 'drawing'
  return <div ref={element} role={isEditing ? undefined : 'button'} tabIndex={isEditing ? undefined : 0} className="line-scheme-dimension-label" data-scheme-dimension={item.id}
    aria-label={`Расстояние ${a.label} — ${b.label}: ${formatSchemeDistance(item.distanceMm)} мм`}
    title={editable ? 'Нажмите, чтобы изменить размер. Перетащите подпись, чтобы сдвинуть размерную линию.' : `${a.label} — ${b.label}`}
    style={{ color: item.color && item.color !== '#64748b' ? item.color : undefined, transform: camera.markerTransform(geometry), cursor: editable ? 'move' : 'default' }}
    onPointerDown={event => {
      event.stopPropagation(); camera.stop()
      if (!editable || isEditing || event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, y: event.clientY, next: item, moved: false }
    }}
    onPointerMove={event => {
      const current = drag.current; if (!current) return
      event.stopPropagation()
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 4) current.moved = true
      if (!current.moved) return
      const point = camera.toPoint(event.clientX, event.clientY)
      const adjusted = schemeDimensionGeometry(a, b, { offsetX: point.x - (a.x + b.x) / 2, offsetY: point.y - (a.y + b.y) / 2 })
      current.next = { ...item, offsetX: adjusted.offsetX, offsetY: adjusted.offsetY }
      if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (drag.current) onPreview(drag.current.next) })
    }}
    onPointerUp={event => { event.stopPropagation(); const current = drag.current; if (!current) return; suppress.current = current.moved; reset(); if (current.moved && editable) onMove(current.next) }}
    onPointerCancel={() => { suppress.current = true; reset() }}
    onClick={event => { event.stopPropagation(); if (suppress.current) { suppress.current = false; return }; if ((editable || editing.item?.id === item.id) && !isEditing) onEdit(item) }} onContextMenu={event => { if ((event.target as Element).closest('input')) return; event.preventDefault(); event.stopPropagation(); onMenu('dimension', item.id, event) }} onKeyDown={event => { if (!isEditing && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) { event.preventDefault(); event.stopPropagation(); onMenu('dimension', item.id, event); return }; if (!isEditing && (editable || editing.item?.id === item.id) && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); onEdit(item) } }}>
    {isEditing ? <LineSchemeDimensionInput item={item} editing={editing} /> : <>{item.distanceMm > 0 ? formatSchemeDistance(item.distanceMm) : '…'} <span className="text-slate-400">мм</span></>}
  </div>
}
