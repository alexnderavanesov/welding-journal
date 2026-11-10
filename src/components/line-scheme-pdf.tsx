import { Select } from './ui/select'
import { Button } from './ui/button'
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCw, Scan, MoveHorizontal } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type MouseEvent, type KeyboardEvent, type RefObject } from 'react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist'
import { loadSchemePdfEngine } from '@/lib/line-scheme-pdf-engine'
import { profileSchemePdf } from '@/lib/line-scheme-pdf-profile'
import { mountSchemePdfPage } from '@/lib/line-scheme-pdf-render'
import { pdfTurn, type PdfCamera, type PdfView } from '@/lib/line-scheme-pdf-camera'
import { SCHEME_LEGEND, schemeAnchors, schemeDimensionEnds, type SchemeAnnotation, type SchemeDimension, type SchemePoint, type SchemeRevision } from '@/lib/line-schemes'
import { schemeDimensionGeometry, SCHEME_POINT_PREVIEW } from '@/lib/line-scheme-dimensions'
import { LineSchemeViewControls, SCHEME_VIEW_MENU } from './line-scheme-view-controls'
import { LineSchemeAnnotationMarker } from './line-scheme-annotation-marker'
import type { SchemeObjectMenuHandler } from '@/lib/line-scheme-interaction'
import type { DimensionEditing } from './line-scheme-dimension-input'
import { LineSchemeDimensions } from './line-scheme-dimensions'
import { LineSchemePointTooltip, SCHEME_POINT_DETAILS_EVENT } from './line-scheme-point-tooltip'

type Props = {
  revision: SchemeRevision; page: number; onPage: (page: number) => void; points: SchemePoint[];
  editable: boolean; placing: boolean; selectedIds: Set<string>;
  controlsTarget: HTMLElement | null;
  focusPoint?: { rootId: number; physicalId: number | null; sequence: number } | null;
  onPlace: (x: number, y: number, rotation: number) => void; onMove: (point: SchemePoint, x: number, y: number) => void;
  onSelect: (point: SchemePoint, additive?: boolean) => void; onOpen: (point: SchemePoint) => void;
  onMenu: (point: SchemePoint, event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) => void;
  onClear: () => void; measuring: boolean;
  focusDimension: { id: string; sequence: number } | null;
  annotations: SchemeAnnotation[]; selectedAnnotationIds: Set<string>; onSelectAnnotation: (item: SchemeAnnotation, additive?: boolean) => void; onObjectMenu: SchemeObjectMenuHandler; onMoveAnnotation: (item: SchemeAnnotation) => void;
  dimensionEditing: DimensionEditing;
  dimensions: SchemeDimension[]; onEditDimension: (dimension: SchemeDimension) => void; onMoveDimension: (dimension: SchemeDimension) => void;
}
export const LineSchemePdf = memo(function LineSchemePdf(props: Props) {
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(false)
  const [loaded, setLoaded] = useState<{ id: string; document: PDFDocumentProxy } | null>(null)
  const [camera, setCamera] = useState<PdfCamera | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const view = useRef<PdfView | null>(null)
  useEffect(() => {
    let disposed = false, task: PDFDocumentLoadingTask | undefined
    profileSchemePdf('open')
    setLoaded(null); setError(false); setCamera(null); view.current = null
    void loadSchemePdfEngine().then(async engine => {
      if (disposed) return
      profileSchemePdf('engine-ready')
      task = engine.open(`/api/line-scheme-file?revision=${props.revision.id}`)
      const document = await task.promise
      profileSchemePdf('document-ready')
      if (!disposed) setLoaded({ id: props.revision.id, document })
    }).catch(() => { if (!disposed) setError(true) })
    return () => { disposed = true; void task?.destroy().catch(() => {}) }
  }, [props.revision.id, attempt])
  const document = loaded?.id === props.revision.id ? loaded.document : null
  const retry = () => setAttempt(value => value + 1)
  return <div ref={frame} className="line-scheme-pdf">
    {document && <LineSchemeViewControls frame={frame} target={props.controlsTarget} camera={camera} page={props.page}>{camera && <PdfToolbar {...props} camera={camera} />}</LineSchemeViewControls>}
    {error ? <PdfError onRetry={retry} /> : document
      ? <PdfSheet key={`${props.revision.id}:${props.page}:${attempt}`} {...props} document={document} view={view} onCamera={setCamera} onRetry={retry} />
      : <div className="p-8 text-sm text-slate-500" role="status">Открываем PDF…</div>}
    {!props.measuring && <LineSchemePointTooltip frame={frame} points={props.points} />}
  </div>
})
function PdfError({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="p-8 text-sm text-red-700">Не удалось открыть PDF. <button className="underline" onClick={onRetry}>Повторить</button></div>
}
function PdfSheet(props: Props & { document: PDFDocumentProxy; view: RefObject<PdfView | null>; onCamera: (camera: PdfCamera | null) => void; onRetry: () => void }) {
  const stage = useRef<HTMLDivElement>(null), space = useRef<HTMLDivElement>(null), sheet = useRef<HTMLDivElement>(null), drawing = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState<PdfCamera | null>(null), [ready, setReady] = useState(false), [error, setError] = useState(false)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const pan = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  useEffect(() => {
    let disposed = false
    profileSchemePdf('page-request')
    void props.document.getPage(props.page).then(page => { profileSchemePdf('page-ready'); if (!disposed) setPage(page) }).catch(() => { if (!disposed) setError(true) })
    return () => { disposed = true }
  }, [props.document, props.page])
  useLayoutEffect(() => {
    if (!page || !stage.current || !space.current || !sheet.current || !drawing.current) return
    let disposed = false
    const surface = mountSchemePdfPage(page, stage.current, space.current, sheet.current, drawing.current,
      () => { if (!disposed) setReady(true) }, () => { if (!disposed) setError(true) }, props.view.current, props.page === 1 ? props.revision.id : undefined)
    setCamera(surface.camera); props.onCamera(surface.camera)
    return () => { disposed = true; const last = surface.camera.getSnapshot(); props.view.current = { ...last, rotation: pdfTurn(last.rotation - page.rotate) }; props.onCamera(null); surface.destroy() }
  }, [page, props.onCamera])
  return <>
    <div ref={stage} className="line-scheme-pdf-stage" aria-label="Чертёж PDF" tabIndex={-1}
      onContextMenu={event => {
        if ((event.target as Element).closest('button, input, [data-scheme-dimension]')) return
        event.preventDefault(); event.stopPropagation()
        event.currentTarget.dispatchEvent(new CustomEvent(SCHEME_VIEW_MENU, { bubbles: true, detail: { x: event.clientX, y: event.clientY, anchorElement: event.currentTarget } }))
      }}
      onPointerDown={event => {
        if (event.button !== 0 || props.placing || (event.target as Element).closest('button, input, [data-scheme-dimension]')) return
        const element = event.currentTarget
        camera?.stop()
        // Leave native scrollbar dragging to the browser.
        const rect = element.getBoundingClientRect()
        if (event.clientX - rect.left >= element.clientWidth || event.clientY - rect.top >= element.clientHeight) return
        event.preventDefault(); element.setPointerCapture(event.pointerId)
        pan.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop, moved: false }
      }}
      onPointerMove={event => { const start = pan.current; if (start) { if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) start.moved = true; if (start.moved) { event.currentTarget.scrollLeft = start.left - event.clientX + start.x; event.currentTarget.scrollTop = start.top - event.clientY + start.y } } }}
      onPointerUp={() => { const start = pan.current; pan.current = null; if (start && !start.moved) props.onClear() }} onPointerCancel={() => { pan.current = null }}>
      <div ref={space} className="line-scheme-pdf-space"><div ref={sheet} className="line-scheme-pdf-sheet">
        <div className="line-scheme-drawing"><div ref={drawing} className="line-scheme-drawing-content" /></div>
        {ready && camera && <PointLayer {...props} context={camera} />}
      </div></div>
    </div>
    {!ready && !error && <div className="line-scheme-load-note" role="status">Открываем лист…</div>}
    {error && <div className="line-scheme-load-note" style={{ pointerEvents: 'auto' }}><PdfError onRetry={props.onRetry} /></div>}
  </>
}
function PdfToolbar(props: Props & { camera: PdfCamera }) {
  const { camera } = props, view = useSyncExternalStore(camera.subscribe, camera.getSnapshot)
  return <>
    <div className="line-scheme-tool-group">
      {props.revision.pageCount > 1 && <Button variant="ghost" size="icon" aria-label="Предыдущий лист" disabled={props.page === 1} onClick={() => props.onPage(props.page - 1)}><ChevronLeft size={16} /></Button>}
      <label className="flex items-center gap-2 px-1"><span className="text-slate-400">Лист</span>{props.revision.pageCount > 1 ? <Select className="h-8 w-16 border-0 bg-transparent py-0 text-xs shadow-none" aria-label="Лист PDF" value={props.page} onChange={event => props.onPage(Number(event.target.value))}>{Array.from({ length: props.revision.pageCount }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</Select> : <span>1</span>}<span className="text-slate-400">из {props.revision.pageCount}</span></label>
      {props.revision.pageCount > 1 && <Button variant="ghost" size="icon" aria-label="Следующий лист" disabled={props.page === props.revision.pageCount} onClick={() => props.onPage(props.page + 1)}><ChevronRight size={16} /></Button>}
    </div>
    <div className="line-scheme-tool-group"><Button variant="ghost" size="icon" aria-label="Уменьшить PDF" onClick={() => camera.zoom(1 / 1.2)}><Minus size={15} /></Button><span className="w-11 text-center tabular-nums">{Math.round(view.scale * 100)}%</span><Button variant="ghost" size="icon" aria-label="Увеличить PDF" onClick={() => camera.zoom(1.2)}><Plus size={15} /></Button></div>
    <div className="line-scheme-tool-group"><Button variant="ghost" size="sm" onClick={() => camera.fit('fit-page')}><Scan size={15} /> Весь лист</Button><Button variant="ghost" size="sm" onClick={() => camera.fit('fit-width')}><MoveHorizontal size={15} /> По ширине</Button></div>
    <Button variant="ghost" size="icon" aria-label="Повернуть" title="Повернуть на 90°" onClick={() => camera.rotate()}><RotateCw size={16} /></Button>
  </>
}
function normalizedPoint(context: PdfCamera, event: { clientX: number; clientY: number }) {
  const point = context.toPoint(event.clientX, event.clientY)
  return { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) }
}
const PointLayer = memo(function PointLayer(props: Props & { context: PdfCamera }) {
  const pending = useRef<{ x: number; y: number } | null>(null), focused = useRef<number | null>(null)
  useEffect(() => {
    const focus = props.focusPoint
    if (!focus || focused.current === focus.sequence) return
    const point = props.points.find(point => focus.physicalId ? point.physicalId === focus.physicalId : point.joint.rootId === focus.rootId)
    if (!point) return
    focused.current = focus.sequence; props.context.reveal(point)
  }, [props.focusPoint, props.points, props.context])
  useEffect(() => {
    const item = props.dimensions.find(item => item.id === props.focusDimension?.id)
    if (!item) return
    const anchors = schemeAnchors(props.points, props.annotations), [from, to] = schemeDimensionEnds(item)
    const a = anchors.find(a => a.key === from), b = anchors.find(a => a.key === to)
    if (a && b) props.context.reveal(schemeDimensionGeometry(a, b, item))
  }, [props.focusDimension, props.context])
  return <div style={{ position: 'absolute', inset: 0, pointerEvents: props.editable && props.placing ? 'auto' : 'none', cursor: props.placing ? 'crosshair' : undefined }}
    data-scheme-point-layer={props.page}
    onPointerDownCapture={event => { if (event.target !== event.currentTarget || !props.editable || !props.placing) return; event.stopPropagation(); props.context.stop(); event.currentTarget.setPointerCapture(event.pointerId); pending.current = { x: event.clientX, y: event.clientY } }}
    onPointerUpCapture={event => { if (!pending.current) return; event.stopPropagation(); const start = pending.current; pending.current = null; if (Math.hypot(start.x - event.clientX, start.y - event.clientY) < 5) { const p = normalizedPoint(props.context, event); props.onPlace(p.x, p.y, props.context.getSnapshot().rotation) } }}
    onPointerCancelCapture={() => { pending.current = null }}>
    {!!props.dimensions.length && <LineSchemeDimensions dimensions={props.dimensions} anchors={schemeAnchors(props.points, props.annotations)} editing={props.dimensionEditing} onMenu={props.onObjectMenu} camera={props.context} editable={props.editable && !props.measuring} onEdit={props.onEditDimension} onMove={props.onMoveDimension} />}
    {props.annotations.map(item => <LineSchemeAnnotationMarker key={item.id} item={item} camera={props.context} selected={props.selectedAnnotationIds.has(item.id)} editable={props.editable} measuring={props.measuring} onSelect={props.onSelectAnnotation} onMove={props.onMoveAnnotation} onMenu={props.onObjectMenu} />)}
    {props.points.map(point => <PointMarker key={point.id} point={point} context={props.context} selected={props.selectedIds.has(point.id)} editable={props.editable} measuring={props.measuring} onSelect={props.onSelect} onOpen={props.onOpen} onMove={props.onMove} onMenu={props.onMenu} />)}
  </div>
})
const PointMarker = memo(function PointMarker({ point, context, editable, selected, measuring, onMove, onSelect, onOpen, onMenu }: {
  point: SchemePoint; context: PdfCamera; editable: boolean; selected: boolean; measuring: boolean;
  onMove: Props['onMove']; onSelect: Props['onSelect']; onOpen: Props['onOpen']; onMenu: Props['onMenu'];
}) {
  const element = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ clientX: number; clientY: number; x: number; y: number; moved: boolean } | null>(null)
  const frame = useRef<number | null>(null), suppressClick = useRef(false)
  useLayoutEffect(() => element.current ? context.trackMarker(element.current, point) : undefined, [context, point.x, point.y])
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const preview = (x: number, y: number) => { if (element.current) { context.moveMarker(element.current, { x, y }); element.current.dispatchEvent(new CustomEvent(SCHEME_POINT_PREVIEW, { bubbles: true, detail: { id: `p:${point.id}`, x, y } })) } }
  const paint = () => { frame.current = null; const p = drag.current; if (p) preview(p.x, p.y) }
  const reset = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; drag.current = null; preview(point.x, point.y) }
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return
    event.stopPropagation(); const d = drag.current; suppressClick.current = d.moved; reset()
    if (d.moved && editable) onMove(point, d.x, d.y)
  }
  const color = SCHEME_LEGEND[point.joint.color]
  return <button ref={element} type="button" data-scheme-point={point.id} aria-label={`Стык ${point.joint.label}`} aria-pressed={selected}
    style={{ position: 'absolute', left: 0, top: 0, width: 16, height: 16, padding: 0, borderRadius: '50%', border: `2px solid ${color.stroke}`, background: color.fill, color: '#0f172a', transform: context.markerTransform(point), pointerEvents: 'auto', touchAction: 'none', cursor: measuring ? 'crosshair' : editable ? 'move' : 'pointer', boxShadow: selected ? '0 0 0 3px #38bdf8aa' : undefined, zIndex: selected ? 2 : 1 }}
    onPointerDownCapture={event => { event.stopPropagation(); context.stop(); if (!editable || measuring || event.button !== 0 || event.ctrlKey || event.metaKey || (event.target as Element).closest('[data-scheme-point-label]')) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { clientX: event.clientX, clientY: event.clientY, x: point.x, y: point.y, moved: false }; onSelect(point) }}
    onPointerMoveCapture={event => { const d = drag.current; if (!d) return; event.stopPropagation(); if (Math.hypot(event.clientX - d.clientX, event.clientY - d.clientY) > 4) d.moved = true; if (d.moved) { Object.assign(d, normalizedPoint(context, event)); if (frame.current === null) frame.current = requestAnimationFrame(paint) } }}
    onPointerUpCapture={end} onPointerCancelCapture={() => { suppressClick.current = true; reset() }}
    onClick={event => { event.stopPropagation(); if (suppressClick.current) { suppressClick.current = false; return }; event.currentTarget.focus({ preventScroll: true }); onSelect(point, event.ctrlKey || event.metaKey); if (!measuring && !event.ctrlKey && !event.metaKey && (event.detail === 0 || (event.target as Element).closest('[data-scheme-point-label]'))) event.currentTarget.dispatchEvent(new CustomEvent(SCHEME_POINT_DETAILS_EVENT, { bubbles: true })) }}
    onDoubleClick={event => { event.stopPropagation(); if (!measuring && !suppressClick.current) onOpen(point) }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onMenu(point, event) }}
    onKeyDown={event => {
      if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); onMenu(point, event) }
    }}>
    {point.joint.color === 'error' && <span style={{ fontSize: 11, lineHeight: '12px' }}>!</span>}
    <span data-scheme-point-label style={{ position: 'absolute', left: 19, top: -3, padding: '1px 4px', borderRadius: 3, background: '#ffffffed', color: '#0f172a', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap', pointerEvents: 'auto', cursor: 'pointer', boxShadow: '0 1px 3px #0002' }}>{point.joint.label}</span>
  </button>
})
