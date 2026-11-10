import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, RefreshCw, Save, Archive, Trash2, ExternalLink, Pencil, RotateCw, Ruler, Palette, Check } from 'lucide-react'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'
import { LineSchemePanelSearch, SCHEME_SEARCH_CLOSE } from './line-scheme-panel-search'
import { LineSchemeNavigationGuard } from './line-scheme-navigation-guard'
import { Select } from './ui/select'
import { Checkbox } from './ui/checkbox'
import { LineSchemeJointList, LineSchemeJointRow } from './line-scheme-joint-list'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { ContextActionMenu } from './context-action-menu'
import { LineSchemeAnnotationPanel } from './line-scheme-annotation-panel'
import type { DimensionEditing } from './line-scheme-dimension-input'
import { LineSchemeDimensionPanel } from './line-scheme-dimension-panel'
import { schemeError, type SchemeSession } from '@/lib/use-line-scheme-session'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useAccess } from '@/lib/security-context'
import { useContainedDialogFocus } from '@/lib/use-contained-dialog-focus'
import { hasVisibleEscapePopup, isTopModalDialog } from '@/lib/modal-layer'
import { selectSchemeItems, type SchemeObjectMenuHandler } from '@/lib/line-scheme-interaction'
import { isContextActionMenuOpen } from '@/lib/context-action-menu-state'
import { SCHEME_DIMENSION_PALETTE, SCHEME_DIMENSION_WIDTHS, SCHEME_LEGEND, canPlaceSchemeJoint, hasSchemePlacementChanges, schemeAnchors, schemeDimensionEnds, schemeDimensionPair, type SchemeAnnotation, type SchemeDimension, type SchemeJoint, type SchemeLine, type SchemePoint, type SchemePointChange } from '@/lib/line-schemes'
import { getLineSchemeDraftStates, getLineSchemeJoints, getLineSchemePoints, openLineScheme, saveLineSchemePoints } from '@/server/line-schemes-api'
import './line-schemes.css'

const Pdf = lazy(() => import('./line-scheme-pdf').then(module => ({ default: module.LineSchemePdf })))
const errorMessage = schemeError
type Draft = { point: SchemePoint; change: SchemePointChange; added: boolean }
type SchemeJointPages = { pages: { rows: SchemeJoint[]; total: number }[]; pageParams: unknown[] }

export function LineSchemeDialog({ line, session, initialRevisionId, onManageFiles, onClose, onOpenJoint }: { line: SchemeLine; session: SchemeSession; initialRevisionId?: string; onManageFiles: () => void; onClose: () => void; onOpenJoint?: (id: number) => void }) {
  const { can } = useAccess(), client = useQueryClient()
  const { token, bundle, setBundle, lease, setLease, opening, error, setError } = session
  const [revisionId, setRevisionId] = useState<string | null>(null), [page, setPage] = useState(1)
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState('')
  const [discardPrompt, setDiscardPrompt] = useState(false)
  const [removedJoints, setRemovedJoints] = useState<Map<number, SchemeJoint>>(new Map())
  const [draft, setDraft] = useState<Map<string, Draft>>(new Map()), [removed, setRemoved] = useState<Set<string>>(new Set())
  const [dimensionDraft, setDimensionDraft] = useState<Map<string, SchemeDimension>>(new Map()), [removedDimensions, setRemovedDimensions] = useState<Set<string>>(new Set())
  const [measuring, setMeasuring] = useState(false), [measureFrom, setMeasureFrom] = useState<string | null>(null)
  const [dimensionEditor, setDimensionEditor] = useState<SchemeDimension | null>(null)
  const [dimensionInputDirty, setDimensionInputDirty] = useState(false), [sideTab, setSideTab] = useState<'joints' | 'dimensions' | 'annotations'>('joints')
  const [dimensionSurface, setDimensionSurface] = useState<'list' | 'drawing'>('list')
  const dimensionBuffer = useRef<{ id: string; value: string } | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState<Map<string, SchemeAnnotation>>(new Map()), [removedAnnotations, setRemovedAnnotations] = useState<Set<string>>(new Set())
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<Set<string>>(new Set()), [annotationEditor, setAnnotationEditor] = useState<SchemeAnnotation | null>(null)
  const [annotationInputDirty, setAnnotationInputDirty] = useState(false), [addingAnnotation, setAddingAnnotation] = useState(false)
  const [placingAnnotation, setPlacingAnnotation] = useState<SchemeAnnotation | null>(null), [annotationsVisible, setAnnotationsVisible] = useState(true)
  const [dimensionsVisible, setDimensionsVisible] = useState(true), [dimensionFocus, setDimensionFocus] = useState<{ id: string; sequence: number } | null>(null)
  const [selectedJoint, setSelectedJoint] = useState<SchemeJoint | null>(null), [selectedPointIds, setSelectedPointIds] = useState<Set<string>>(new Set())
  const [focusPoint, setFocusPoint] = useState<{ rootId: number; physicalId: number | null; sequence: number } | null>(null)
  const [pointMenu, setPointMenu] = useState<{ id: string; x: number; y: number; anchorElement: HTMLButtonElement } | null>(null)
  const [objectMenu, setObjectMenu] = useState<{ kind: 'annotation' | 'dimension'; id: string; x: number; y: number; anchorElement: HTMLElement } | null>(null)
  const focusSequence = useRef(0), selectedFocusSequence = useRef<number | null>(null)
  const [text, setText] = useState(''), [unplaced, setUnplaced] = useState(false)
  const [pdfControls, setPdfControls] = useState<HTMLDivElement | null>(null)
  const [closePrompt, setClosePrompt] = useState(false), [retry, setRetry] = useState<(() => Promise<void>) | null>(null)
  const [updatingDraft, setUpdatingDraft] = useState(false)
  const draftRefreshAbort = useRef<AbortController | null>(null), draftRef = useRef(draft); draftRef.current = draft
  const alive = useRef(true), bundleRef = useRef(bundle); bundleRef.current = bundle
  const changeCount = draft.size + removed.size + dimensionDraft.size + removedDimensions.size + annotationDraft.size + removedAnnotations.size
  const inputDirty = dimensionInputDirty || annotationInputDirty
  const dirty = changeCount > 0 || inputDirty, revision = bundle?.revisions.find(item => item.id === revisionId)
  const current = !!revision && revisionId === bundle?.activeRevisionId
  const editable = current && !bundle?.deleted && lease.owned && can('schemes.edit') && !busy && !retry
  const search = useDebouncedValue(text, 250)
  const pointKey = ['line-scheme-points', token, revisionId, page] as const
  const pointsQuery = useQuery({ queryKey: pointKey, enabled: !!revisionId,
    queryFn: async ({ signal }) => {
      const points: SchemePoint[] = [], dimensions: SchemeDimension[] = [], annotations: SchemeAnnotation[] = []; let after: string | undefined, version = 0, updatedAt = ''
      do {
        const part = await getLineSchemePoints({ data: { revisionId: revisionId!, page, after }, signal })
        if (version && version !== part.version) throw new Error('Разметка изменилась во время загрузки. Обновите состояния.')
        version = part.version; updatedAt = part.updatedAt; points.push(...part.points); dimensions.push(...part.dimensions); annotations.push(...part.annotations); after = part.next ?? undefined
      } while (after)
      return { points, dimensions, annotations, version, updatedAt }
    }, staleTime: Infinity, refetchOnWindowFocus: false, retry: false,
  })
  const listQuery = useInfiniteQuery({ queryKey: ['line-scheme-joints', token, bundle?.id, revisionId, search, unplaced], enabled: !!bundle && !!revisionId,
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => getLineSchemeJoints({ data: { bundleId: bundle!.id, revisionId: revisionId ?? undefined, page: pageParam, search, unplaced }, signal }),
    getNextPageParam: (last, pages) => pages.reduce((sum, part) => sum + part.rows.length, 0) < last.total ? pages.length : undefined,
    staleTime: Infinity, refetchOnWindowFocus: false, retry: false,
  })
  const loadedJoints = useMemo(() => [...new Map((listQuery.data?.pages ?? []).flatMap(part => part.rows).map(row => [row.key, row])).values()], [listQuery.data])
  const loadMoreJoints = useCallback(() => { void (listQuery.isFetchNextPageError || !listQuery.error ? listQuery.fetchNextPage() : listQuery.refetch()) }, [listQuery.fetchNextPage, listQuery.refetch, listQuery.error, listQuery.isFetchNextPageError])
  const visiblePoints = useMemo(() => {
    const points = new Map((pointsQuery.data?.points ?? []).filter(point => !removed.has(point.id)).map(point => [point.id, point]))
    for (const { point } of draft.values()) {
      const fresh = points.get(point.id)?.joint
      if (point.page === page) points.set(point.id, fresh ? { ...point, joint: fresh } : point); else points.delete(point.id)
    }
    return [...points.values()].map(point => pointsQuery.error && !draft.get(point.id)?.added ? { ...point, joint: { ...point.joint, color: 'error' as const, reason: 'Не удалось обновить состояние. Повторите получение состояний.' } } : point)
  }, [pointsQuery.data, pointsQuery.error, removed, draft, page])
  const visibleAnnotations = useMemo(() => {
    const result = new Map((pointsQuery.data?.annotations ?? []).filter(a => !removedAnnotations.has(a.id)).map(a => [a.id, a]))
    for (const a of annotationDraft.values()) { result.delete(a.id); if (a.page === page) result.set(a.id, a) }
    return [...result.values()]
  }, [pointsQuery.data, annotationDraft, removedAnnotations, page])
  const anchors = useMemo(() => schemeAnchors(visiblePoints, visibleAnnotations), [visiblePoints, visibleAnnotations])
  const visibleDimensions = useMemo(() => {
    const result = new Map((pointsQuery.data?.dimensions ?? []).filter(item => !removedDimensions.has(item.id)).map(item => [item.id, item]))
    for (const item of dimensionDraft.values()) if (item.page === page) result.set(item.id, item)
    const ids = new Set(anchors.map(a => a.key))
    return [...result.values()].filter(item => schemeDimensionEnds(item).every(id => ids.has(id)))
  }, [pointsQuery.data, dimensionDraft, removedDimensions, anchors, page])
  const displayedDimensions = dimensionEditor && !visibleDimensions.some(d => d.id === dimensionEditor.id) ? [...visibleDimensions, dimensionEditor] : visibleDimensions
  const selectedAnnotations = visibleAnnotations.filter(a => selectedAnnotationIds.has(a.id))
  const selectedPoints = visiblePoints.filter(point => selectedPointIds.has(point.id))
  const selectedAnchors = anchors.filter(a => a.kind === 'point' ? selectedPointIds.has(a.id) : selectedAnnotationIds.has(a.id))
  const selectedCount = selectedAnchors.length
  const selection = selectedPoints.length === 1 ? selectedPoints[0] : null
  function setSelectedPoint(point: SchemePoint | null) { setSelectedPointIds(new Set(point ? [point.id] : [])) }
  useEffect(() => {
    if (!focusPoint || selectedFocusSequence.current === focusPoint.sequence) return
    const point = visiblePoints.find(point => focusPoint.physicalId ? point.physicalId === focusPoint.physicalId : point.joint.rootId === focusPoint.rootId)
    if (point) { selectedFocusSequence.current = focusPoint.sequence; setSelectedPoint(point) }
  }, [focusPoint, visiblePoints])
  const refreshStates = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['line-scheme-joints', token] })
    void client.invalidateQueries({ queryKey: ['line-scheme-points', token] })
    draftRefreshAbort.current?.abort()
    const roots = [...new Set([...draftRef.current.values()].filter(item => item.added).map(item => item.change.rootId!))]
    if (!roots.length || !bundleRef.current) { setUpdatingDraft(false); return }
    const bundleId = bundleRef.current.id, controller = new AbortController(); draftRefreshAbort.current = controller
    setUpdatingDraft(true)
    void (async () => {
      const states = new Map<number, SchemeJoint>()
      try {
        for (let offset = 0; offset < roots.length; offset += 500) {
          const rows = await getLineSchemeDraftStates({ data: { bundleId, roots: roots.slice(offset, offset + 500) }, signal: controller.signal })
          for (const row of rows) states.set(row.rootId, row)
        }
        if (controller.signal.aborted || !alive.current) return
        setDraft(previous => new Map([...previous].map(([id, item]) => {
          const fresh = item.added ? states.get(item.change.rootId!) : null
          if (!fresh) return [id, item]
          const joint = !fresh.rowId && fresh.label.startsWith('#') ? { ...fresh, label: item.point.joint.label } : fresh
          return [id, { ...item, point: { ...item.point, joint, physicalId: fresh.physicalId ?? item.point.physicalId }, change: { ...item.change, ...(fresh.physicalId ? { physicalId: fresh.physicalId } : {}) } }]
        })))
      } catch {
        if (controller.signal.aborted || !alive.current) return
        setDraft(previous => new Map([...previous].map(([id, item]) => [id, item.added ? { ...item, point: { ...item.point, joint: { ...item.point.joint, color: 'error' as const, reason: 'Не удалось обновить состояние. Повторите получение состояний.' } } } : item])))
      } finally { if (!controller.signal.aborted && alive.current) setUpdatingDraft(false) }
    })()
  }, [client, token])
  // Local successful mutations refresh state; other users are read on explicit refresh.
  useEffect(() => client.getMutationCache().subscribe(event => {
    if (event.type === 'updated' && event.action.type === 'success') refreshStates()
  }), [client, refreshStates])
  async function reopen(selectMain = false, discarded = false) {
    const next = await session.read()
    if (!alive.current) return
    if (dirty && !discarded && (next.bundle?.version !== bundle?.version || next.bundle?.revisions.find(item => item.id === revisionId)?.version !== revision?.version)) {
      throw new Error('Схема изменена в другом окне. Ваши точки остаются здесь. Отмените свои изменения, чтобы открыть новую разметку.')
    }
    session.apply(next)
    if (selectMain || !revisionId || !next.bundle?.revisions.some(item => item.id === revisionId)) {
      setRevisionId(next.bundle?.activeRevisionId ?? next.bundle?.revisions.at(-1)?.id ?? null); setPage(1)
    }
    return next
  }
  useEffect(() => {
    if (!bundle || revisionId) return
    setRevisionId(bundle.revisions.some(item => item.id === initialRevisionId) ? initialRevisionId! : bundle.activeRevisionId ?? bundle.revisions.at(-1)?.id ?? null)
  }, [bundle, initialRevisionId, revisionId])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false; draftRefreshAbort.current?.abort()
      void client.cancelQueries({ queryKey: ['line-scheme-points', token] }); client.removeQueries({ queryKey: ['line-scheme-points', token] })
      void client.cancelQueries({ queryKey: ['line-scheme-joints', token] }); client.removeQueries({ queryKey: ['line-scheme-joints', token] })
    }
  }, [client, token])
  async function acquire() {
    setBusy('Проверяем доступ…'); setError(''); setNotice('')
    try {
      const latest = await reopen()
      if (!alive.current || !latest) return
      // A busy lease check only needs metadata; refresh drawing states once
      // editing is actually acquired, before the next save.
      if (latest.lease.owned) refreshStates()
      setLease(latest.lease)
      setNotice(latest.lease.owned ? 'Доступ получен. Основную редакцию можно редактировать.' : `Редактирование пока занято: ${latest.lease.name ?? 'другое окно'}. Закройте другое окно схемы или дождитесь освобождения доступа и повторите.`)
    } catch (reason) { if (alive.current) setError(errorMessage(reason)) }
    finally { if (alive.current) setBusy('') }
  }
  const close = () => { if (!busy) { if (dirty || retry) setClosePrompt(true); else onClose() } }
  // Escape always asks, including a clean/view-only drawing. Nested layers
  // consume their own Escape before the drawing receives it.
  const focus = useContainedDialogFocus(() => {
    const searchPanel = document.activeElement?.closest('[data-scheme-panel-search="open"]')
    if (searchPanel) { searchPanel.dispatchEvent(new Event(SCHEME_SEARCH_CLOSE)); return }
    if (annotationEditor || placingAnnotation) { cancelAnnotation(); return }
    if (dimensionEditor) { cancelDimension(); return }
    if (measuring) { cancelDimension(); return }
    setClosePrompt(true)
  }, !!busy)
  function clearSelection() { if (!annotationInputDirty) { setSelectedAnnotationIds(new Set()); setAnnotationEditor(null); setPlacingAnnotation(null) }; setSelectedJoint(null); setSelectedPoint(null); setFocusPoint(null); setMeasureFrom(null); setNotice(''); setPointMenu(null); setObjectMenu(null) }
  function cancelDimension() { dimensionBuffer.current = null; setDimensionEditor(null); setDimensionInputDirty(false); setMeasuring(false); clearSelection() }
  function discard() { setAnnotationDraft(new Map()); setRemovedAnnotations(new Set()); cancelAnnotation(); dimensionBuffer.current = null; setDimensionInputDirty(false); setDraft(new Map()); setRemoved(new Set()); setRemovedJoints(new Map()); setDimensionDraft(new Map()); setRemovedDimensions(new Set()); setMeasuring(false); setDimensionEditor(null); clearSelection(); setRetry(null); setError('') }
  function writeRequest() {
    if (!bundle) throw new Error('Схема не открыта.')
    return { bundleId: bundle.id, token, version: bundle.version, operationId: crypto.randomUUID() }
  }
  async function save(closeAfter = false) {
    if (!bundle || !revision || !dirty || !lease.owned || inputDirty) return
    const data = { ...writeRequest(), revisionId: revision.id, revisionVersion: revision.version, changes: { upsert: [...draft.values()].map(item => item.change), remove: [...removed],
      ...(annotationDraft.size || removedAnnotations.size ? { annotations: { upsert: [...annotationDraft.values()], remove: [...removedAnnotations] } } : {}),
      ...(dimensionDraft.size || removedDimensions.size ? { dimensions: { upsert: [...dimensionDraft.values()], remove: [...removedDimensions] } } : {}) } }
    const placementChanged = hasSchemePlacementChanges(data.changes, draft.size
      ? client.getQueriesData<{ points: SchemePoint[] }>({ queryKey: ['line-scheme-points', token, revision.id] }).flatMap(([, cached]) => cached?.points ?? []) : [])
    let attempts = 0
    const run = async () => {
      const replay = attempts++ > 0
      setBusy('Сохраняем разметку…'); setError('')
      try {
        await client.cancelQueries({ queryKey: ['line-scheme-points', token, revision.id] })
        const result = await saveLineSchemePoints({ data, signal: AbortSignal.timeout(15_000) })
        if (!alive.current) return
        // A receipt confirms our operation, but another editor may have saved
        // later while our response was lost. Only retry needs this extra read.
        const latest = replay ? await openLineScheme({ data: { lineId: line.lineId, token, acquire: false }, signal: AbortSignal.timeout(15_000) }) : null
        if (!alive.current) return
        const receiptIsCurrent = !latest || latest.bundle?.revisions.find(item => item.id === revision.id)?.version === result.revisionVersion
        await client.cancelQueries({ queryKey: ['line-scheme-points', token, revision.id] })
        const ids = new Map(result.points.map(point => [point.id, point.physicalId]))
        // Keep the existing list (and its scroll position) during the refresh.
        // Commit known placement changes immediately so badges do not flash back.
        if (receiptIsCurrent) {
          const placedByRoot = new Map([...draft.values()].map(item => [item.point.joint.rootId, item]))
          const placedByPhysical = new Map([...draft.values()].filter(item => item.point.physicalId).map(item => [item.point.physicalId, item]))
          client.setQueriesData<SchemeJointPages>({ queryKey: ['line-scheme-joints', token, bundle.id, revision.id] }, old => old && ({ ...old,
            pages: old.pages.map(part => ({ ...part, rows: part.rows.map(joint => {
              const changed = (joint.physicalId ? placedByPhysical.get(joint.physicalId) : undefined) ?? placedByRoot.get(joint.rootId)
              if (changed) { const physicalId = ids.get(changed.point.id) ?? changed.point.physicalId; return { ...joint, physicalId, key: `p:${physicalId}`, placedPage: changed.point.page } }
              return joint.physicalId && removedJoints.has(joint.physicalId) ? { ...joint, placedPage: null } : joint
            }) })),
          }))
        }
        for (const [key, old] of client.getQueriesData<{ points: SchemePoint[]; dimensions: SchemeDimension[]; annotations: SchemeAnnotation[]; version: number; updatedAt: string }>({ queryKey: ['line-scheme-points', token, revision.id] })) {
          if (!old || !receiptIsCurrent) continue
          const points = new Map(old.points.filter(point => !removed.has(point.id)).map(point => [point.id, point]))
          for (const { point } of draft.values()) {
            const fresh = points.get(point.id)?.joint ?? point.joint
            points.delete(point.id)
            if (point.page === key[3]) { const physicalId = ids.get(point.id) ?? point.physicalId; points.set(point.id, { ...point, physicalId, joint: { ...fresh, physicalId, key: `p:${physicalId}` } }) }
          }
          const dimensions = new Map(old.dimensions.filter(item => !removedDimensions.has(item.id) && ![item.fromPointId, item.toPointId].some(id => id && removed.has(id)) && ![item.fromAnnotationId, item.toAnnotationId].some(id => id && removedAnnotations.has(id))).map(item => [item.id, item]))
          for (const item of dimensionDraft.values()) { dimensions.delete(item.id); if (item.page === key[3]) dimensions.set(item.id, item) }
          const annotations = new Map(old.annotations.filter(a => !removedAnnotations.has(a.id)).map(a => [a.id, a]))
          for (const a of annotationDraft.values()) { annotations.delete(a.id); if (a.page === key[3]) annotations.set(a.id, a) }
          client.setQueryData(key, { ...old, annotations: [...annotations.values()], points: [...points.values()], dimensions: [...dimensions.values()], version: result.revisionVersion })
        }
        if (latest) {
          setBundle(latest.bundle); setLease(latest.lease)
          if (!latest.bundle?.revisions.some(item => item.id === revision.id)) { setRevisionId(latest.bundle?.activeRevisionId ?? null); setPage(1) }
        } else setBundle(previous => previous && ({ ...previous, revisions: previous.revisions.map(item => item.id === revision.id ? { ...item, version: result.revisionVersion } : item) }))
        discard(); setNotice('Разметка сохранена')
        // A geometry-only save cannot change the list's placement badges or
        // filters. Avoid rereading every loaded infinite-query page. A replay
        // can follow another editor's changes, so it always refreshes the list.
        if (replay || placementChanged) void client.invalidateQueries({ queryKey: ['line-scheme-joints', token] })
        void client.invalidateQueries({ queryKey: ['line-scheme-points', token, revision.id], refetchType: 'active' })
        if (closeAfter) onClose()
      } catch (reason) { setError(errorMessage(reason)); setRetry(() => run) }
      finally { if (alive.current) setBusy('') }
    }
    await run()
  }
  const movePoint = useCallback((point: SchemePoint, x: number, y: number) => {
    setDraft(previous => { const next = new Map(previous), old = previous.get(point.id); next.set(point.id, { added: old?.added ?? false, point: { ...point, x, y }, change: { ...(old?.change ?? { id: point.id, page: point.page }), x, y } }); return next })
  }, [])
  const addPoint = (x: number, y: number, rotation: number) => {
    if (placingAnnotation && editable && !pointsQuery.isFetching && !pointsQuery.error) {
      const item = { ...placingAnnotation, x, y, page, rotation: (placingAnnotation.rotation - rotation + 360) % 360 }; setAnnotationDraft(previous => new Map(previous).set(item.id, item)); setPlacingAnnotation(null); setSelectedAnnotationIds(new Set([item.id])); setNotice('Обозначение добавлено. Нажмите «Сохранить».'); return
    }
    if (!selectedJoint || !editable || !pointsQuery.data || pointsQuery.isFetching || pointsQuery.error) return
    const id = crypto.randomUUID(), joint = selectedJoint
    const point: SchemePoint = { id, physicalId: joint.physicalId ?? 0, page, x, y, joint }
    setDraft(previous => new Map(previous).set(id, { added: true, point, change: { id, page, x, y, rootId: joint.rootId, ...(joint.physicalId ? { physicalId: joint.physicalId } : {}) } }))
    setSelectedJoint(null); setSelectedPoint(point); setFocusPoint(null); setNotice('Точка добавлена. Нажмите «Сохранить».')
  }
  const removePoints = (points: SchemePoint[]) => {
    if (!editable || pointsQuery.isFetching || pointsQuery.error || !points.length) return
    const ids = new Set(points.map(point => point.id)), saved = points.filter(point => !draft.get(point.id)?.added)
    if (measureFrom?.startsWith('p:') && ids.has(measureFrom.slice(2))) setMeasureFrom(null)
    if (dimensionEditor && schemeDimensionEnds(dimensionEditor).some(key => key.startsWith('p:') && ids.has(key.slice(2)))) { setDimensionEditor(null); setDimensionInputDirty(false) }
    setRemoved(previous => new Set([...previous, ...saved.map(point => point.id)]))
    setRemovedJoints(previous => new Map([...previous, ...saved.map(point => [point.physicalId, point.joint] as const)]))
    setDimensionDraft(previous => new Map([...previous].filter(([, item]) => !schemeDimensionEnds(item).some(key => key.startsWith('p:') && ids.has(key.slice(2))))))
    setDraft(previous => new Map([...previous].filter(([id]) => !ids.has(id))))
    setSelectedPoint(null); setFocusPoint(null); setPointMenu(null)
    setNotice(points.length === 1 ? 'Точка убрана со схемы. Нажмите «Сохранить».' : `Убрано точек: ${points.length}. Нажмите «Сохранить».`)
  }
  function jointClick(joint: SchemeJoint, additive = false) {
    if (annotationInputDirty) { setNotice('Сначала примените или отмените оформление обозначения.'); return }
    cancelAnnotation(additive && !measuring);
    if (dimensionInputDirty && placement(joint).page && placement(joint).page !== page) { setNotice('Сначала примените или отмените введённый размер.'); return }
    if (additive && !measuring) {
      const point = visiblePoints.find(item => item.joint.key === joint.key || !!joint.physicalId && item.physicalId === joint.physicalId)
      if (point) selectPoint(point, true)
      else setNotice('Групповой выбор доступен для нанесённых точек текущего листа.')
      return
    }
    if (measuring) {
      const point = visiblePoints.find(item => item.joint.key === joint.key || !!joint.physicalId && item.physicalId === joint.physicalId)
      if (point) { selectPoint(point); return }
      setNotice('Для размера выберите две нанесённые точки на текущем листе.'); return
    }
    const focus = () => setFocusPoint({ rootId: joint.rootId, physicalId: joint.physicalId, sequence: ++focusSequence.current })
    const local = [...draft.values()].find(item => item.point.joint.key === joint.key || joint.physicalId && item.point.physicalId === joint.physicalId)
    if (local) { setPage(local.point.page); setSelectedPoint(local.point); setSelectedJoint(null); focus(); return }
    if (joint.placedPage && !removedJoints.has(joint.physicalId ?? -1)) { setPage(joint.placedPage); setSelectedJoint(null); setSelectedPoint(null); focus(); setNotice(`${joint.label} · Лист ${joint.placedPage}`); return }
    if (editable && canPlaceSchemeJoint(joint)) { setSelectedJoint(joint); setSelectedPoint(null); setFocusPoint(null); setNotice('') }
    else if (editable) setNotice(`Нельзя определить физическую привязку: ${joint.reason}`)
  }
  const draftPlacements = useMemo(() => {
    const result = new Map<string, number>()
    for (const { point } of draft.values()) { result.set(point.joint.key, point.page); if (point.physicalId) result.set(`p:${point.physicalId}`, point.page) }
    return result
  }, [draft])
  const placement = (joint: SchemeJoint) => {
    const local = draftPlacements.get(joint.key) ?? (joint.physicalId ? draftPlacements.get(`p:${joint.physicalId}`) : undefined)
    if (local) return { page: local, draft: true }
    return { page: removedJoints.has(joint.physicalId ?? -1) ? null : joint.placedPage, draft: false }
  }
  const listed = loadedJoints.filter(joint => !unplaced || !placement(joint).page)
  if (unplaced) for (const joint of removedJoints.values()) {
    if (canPlaceSchemeJoint(joint) && !placement(joint).page && joint.label.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')) && !listed.some(item => item.key === joint.key)) listed.unshift(joint)
  }
  useEffect(() => { cancelAnnotation(); dimensionBuffer.current = null; setPointMenu(null); setObjectMenu(null); setMeasuring(false); setMeasureFrom(null); setDimensionEditor(null); setDimensionInputDirty(false); setDimensionFocus(null) }, [page, revisionId])
  function selectPoint(point: SchemePoint, additive = false) {
    if (annotationInputDirty) { setNotice('Сначала примените или отмените оформление обозначения.'); return }
    cancelAnnotation(additive && !measuring)
    if (additive && !measuring) setSelectedPointIds(previous => { const next = new Set(previous); if (next.has(point.id)) next.delete(point.id); else next.add(point.id); return next })
    else setSelectedPoint(point)
    setSelectedJoint(null); setFocusPoint(null); setNotice('')
    selectMeasureAnchor(`p:${point.id}`)
  }
  function startDimension(from: string, to: string, surface: 'list' | 'drawing' = 'drawing') {
    if (!editable || inputDirty || pointsQuery.isFetching || pointsQuery.error || from === to) return
    const pair = schemeDimensionPair(from, to)
    const existing = visibleDimensions.find(item => schemeDimensionEnds(item).join() === schemeDimensionEnds({ ...pair } as SchemeDimension).join())
    clearSelection(); cancelAnnotation(); setSideTab('dimensions'); setDimensionSurface(surface); setDimensionsVisible(true); setAnnotationsVisible(true)
    dimensionBuffer.current = null; setDimensionInputDirty(!existing)
    setDimensionEditor(existing ?? { id: crypto.randomUUID(), ...pair, page, distanceMm: 0, offsetX: 0, offsetY: -.035 })
    setMeasuring(false); setMeasureFrom(null)
  }
  function selectMeasureAnchor(key: string) {
    if (!measuring || !editable) return
    if (!measureFrom) { setMeasureFrom(key); return }
    startDimension(measureFrom, key)
  }
  function cancelAnnotation(keepSelection = false) { setAnnotationEditor(null); setAnnotationInputDirty(false); setPlacingAnnotation(null); setAddingAnnotation(false); if (keepSelection !== true) setSelectedAnnotationIds(new Set()) }
  function selectAnnotation(item: SchemeAnnotation, additive = false) {
    if (inputDirty) { setNotice('Сначала примените или отмените введённые изменения.'); return }
    setSelectedJoint(null); if (!additive || measuring) setSelectedPoint(null); setFocusPoint(null); setSelectedAnnotationIds(previous => selectSchemeItems(previous, item.id, additive && !measuring)); setNotice('')
    if (measuring) { selectMeasureAnchor(`a:${item.id}`); return }
    setSideTab('annotations'); setAddingAnnotation(false); setPlacingAnnotation(null); setAnnotationEditor(additive ? null : item)
  }
  const moveAnnotation = useCallback((item: SchemeAnnotation) => { setAnnotationDraft(previous => new Map(previous).set(item.id, item)) }, [])
  function removeAnnotations(items: SchemeAnnotation[]) {
    if (!editable || pointsQuery.isFetching || pointsQuery.error || !items.length) return
    const ids = new Set(items.map(a => a.id)), keys = new Set(items.map(a => `a:${a.id}`))
    const saved = (pointsQuery.data?.annotations ?? []).filter(a => ids.has(a.id))
    setRemovedAnnotations(previous => new Set([...previous, ...saved.map(a => a.id)]))
    setAnnotationDraft(previous => new Map([...previous].filter(([id]) => !ids.has(id))))
    setDimensionDraft(previous => new Map([...previous].filter(([, d]) => !schemeDimensionEnds(d).some(key => keys.has(key)))))
    if (dimensionEditor && schemeDimensionEnds(dimensionEditor).some(key => keys.has(key))) cancelDimension()
    if (measureFrom && keys.has(measureFrom)) setMeasureFrom(null)
    cancelAnnotation(); setNotice(`Убрано обозначений: ${items.length}, вместе со связанными размерами. Нажмите «Сохранить».`)
  }
  const moveDimension = useCallback((item: SchemeDimension) => { if (item.distanceMm <= 0) { setDimensionEditor(item); return }; setDimensionDraft(previous => new Map(previous).set(item.id, item)) }, [])
  function editDimension(item: SchemeDimension, surface: 'list' | 'drawing' = 'list') {
    if (annotationInputDirty) { setNotice('Сначала примените или отмените оформление обозначения.'); return }
    if (dimensionInputDirty && dimensionEditor?.id !== item.id) { setNotice('Сначала примените или отмените введённый размер.'); return }
    clearSelection(); cancelAnnotation(); setMeasuring(false); setSideTab('dimensions'); setDimensionsVisible(true); setAnnotationsVisible(true); setDimensionSurface(surface)
    if (surface === 'list') setDimensionFocus({ id: item.id, sequence: ++focusSequence.current })
    if (editable && dimensionEditor?.id !== item.id) { dimensionBuffer.current = null; setDimensionEditor(item); setDimensionInputDirty(false) }
  }
  function removeDimension(item: SchemeDimension) {
    if (!editable || pointsQuery.isFetching || pointsQuery.error) return
    if (pointsQuery.data?.dimensions.some(value => value.id === item.id)) setRemovedDimensions(previous => new Set(previous).add(item.id))
    setDimensionDraft(previous => { const next = new Map(previous); next.delete(item.id); return next }); if (dimensionEditor?.id === item.id) { setDimensionEditor(null); setDimensionInputDirty(false) }
    setNotice('Размер удалён. Нажмите «Сохранить».')
  }
  function applyDimension(item: SchemeDimension) {
    if (!editable) return
    moveDimension({ ...(visibleDimensions.find(value => value.id === item.id) ?? item), distanceMm: item.distanceMm }); cancelDimension(); setNotice('Размер изменён. Нажмите «Сохранить».')
  }
  const dimensionEditing: DimensionEditing = { item: dimensionEditor, surface: dimensionSurface, editable: editable && !pointsQuery.isFetching && !pointsQuery.error, buffer: dimensionBuffer, onApply: applyDimension, onCancel: cancelDimension, onDirty: setDimensionInputDirty }
  const openObjectMenu: SchemeObjectMenuHandler = (kind, id, event) => {
    setPointMenu(null)
    if (!inputDirty) {
      setMeasuring(false); setMeasureFrom(null); setSelectedJoint(null); setFocusPoint(null)
      setAnnotationEditor(null); setPlacingAnnotation(null)
      if (kind === 'annotation') { if (!selectedAnnotationIds.has(id)) { setSelectedAnnotationIds(new Set([id])); setSelectedPoint(null) }; setSideTab('annotations') }
      else { setSelectedAnnotationIds(new Set()); setSelectedPoint(null) }
    }
    const anchorElement = event.currentTarget, rect = anchorElement.getBoundingClientRect()
    setObjectMenu({ kind, id, x: 'clientX' in event ? event.clientX : rect.left, y: 'clientY' in event ? event.clientY : rect.bottom, anchorElement })
  }
  const menuAnnotation = objectMenu?.kind === 'annotation' ? visibleAnnotations.find(a => a.id === objectMenu.id) : undefined
  const menuDimension = objectMenu?.kind === 'dimension' ? displayedDimensions.find(d => d.id === objectMenu.id) : undefined
  const menuAnnotations = menuAnnotation ? selectedAnnotationIds.has(menuAnnotation.id) ? selectedAnnotations : [menuAnnotation] : []
  const objectWriteDisabled = !dimensionEditing.editable || inputDirty
  function removeSelection() {
    if (objectWriteDisabled) return
    removePoints(selectedPoints); removeAnnotations(selectedAnnotations)
    setNotice(`Убрано объектов: ${selectedCount}, вместе со связанными размерами. Нажмите «Сохранить».`)
  }
  const groupMenuItems = [
    ...(selectedCount === 2 ? [{ id: 'dimension', label: 'Задать размер', icon: Ruler, disabled: objectWriteDisabled, onSelect: () => startDimension(selectedAnchors[0].key, selectedAnchors[1].key) }] : []),
    { id: 'remove-group', label: `Убрать выбранные объекты (${selectedCount})`, icon: Trash2, danger: true, disabled: objectWriteDisabled, onSelect: removeSelection },
  ]
  const objectMenuItems = menuAnnotation && selectedCount > 1 ? groupMenuItems : menuAnnotation ? [
    { id: 'edit-annotation', label: 'Оформление', icon: Pencil, disabled: inputDirty || menuAnnotations.length > 1, onSelect: () => selectAnnotation(menuAnnotation) },
    { id: 'rotate-annotation', label: 'Повернуть на 90°', icon: RotateCw, disabled: objectWriteDisabled || menuAnnotations.length > 1, onSelect: () => moveAnnotation({ ...menuAnnotation, rotation: (menuAnnotation.rotation + 90) % 360 }) },
    { id: 'remove-annotations', label: menuAnnotations.length > 1 ? `Убрать выбранные обозначения (${menuAnnotations.length})` : 'Убрать обозначение', icon: Trash2, danger: true, disabled: objectWriteDisabled, onSelect: () => removeAnnotations(menuAnnotations) },
  ] : menuDimension ? [
    { id: 'edit-dimension', label: 'Изменить значение', icon: Pencil, disabled: objectWriteDisabled, onSelect: () => editDimension(menuDimension, objectMenu?.anchorElement.closest('.line-scheme-canvas') ? 'drawing' : 'list') },
    { id: 'dimension-color', label: 'Цвет', icon: Palette, disabled: objectWriteDisabled, onSelect: () => {}, children: SCHEME_DIMENSION_PALETTE.map(({ color, name }) => ({ id: color, label: name, disabled: objectWriteDisabled, icon: (menuDimension.color ?? '#64748b') === color ? Check : undefined, onSelect: () => { if (!objectWriteDisabled) moveDimension({ ...menuDimension, color }) } })) },
    { id: 'dimension-width', label: 'Толщина линии', disabled: objectWriteDisabled, onSelect: () => {}, children: SCHEME_DIMENSION_WIDTHS.map(strokeWidth => ({ id: String(strokeWidth), label: String(strokeWidth).replace('.', ','), disabled: objectWriteDisabled, icon: (menuDimension.strokeWidth ?? 1.5) === strokeWidth ? Check : undefined, onSelect: () => { if (!objectWriteDisabled) moveDimension({ ...menuDimension, strokeWidth }) } })) },
    { id: 'remove-dimension', label: 'Удалить размер', icon: Trash2, danger: true, disabled: objectWriteDisabled, onSelect: () => removeDimension(menuDimension) },
  ] : []
  const canInspect = (joint: SchemeJoint) => !!(joint.rowId ?? joint.inspectionRowId) && !!onOpenJoint && can('welding.view')
  const inspectJoint = (joint: SchemeJoint) => { const id = joint.rowId ?? joint.inspectionRowId; if (id && canInspect(joint)) onOpenJoint?.(id) }
  const menuPoint = pointMenu && visiblePoints.find(point => point.id === pointMenu.id)
  const closePointMenu = () => { const anchor = pointMenu?.anchorElement ?? objectMenu?.anchorElement; if (anchor?.isConnected) anchor.focus({ preventScroll: true }); setPointMenu(null); setObjectMenu(null) }
  const accessText = opening ? 'Открываем схему…' : bundle?.deleted ? 'Линия удалена · только просмотр' : revision && !current ? 'Архив · только просмотр' : lease.owned && can('schemes.edit') ? 'Редактирование доступно' : !lease.owned && lease.name ? `Редактирует: ${lease.name} · только просмотр` : 'Только просмотр'
  const feedback = error || busy || notice || (measuring ? measureFrom ? 'Размер: выберите второй стык или обозначение' : 'Размер: выберите первый стык или обозначение' : selectedCount > 1 ? `Выбрано объектов: ${selectedCount} · Delete — убрать` : selectedJoint ? `Размещение: ${selectedJoint.label} · укажите место на чертеже` : selectedPoints.length > 1 ? `Выбрано точек: ${selectedPoints.length} · Delete — убрать со схемы` : selection ? `Выбран стык ${selection.joint.label}` : '')
  return <LargeDialogShell ariaLabel={`Схема линии ${line.line}`} maxWidthClassName="max-w-none" maxHeightClassName="max-h-none" panelClassName="line-scheme-shell" overlayClassName="z-[60] bg-slate-950/30">
    <LineSchemeNavigationGuard dirty={dirty || !!placingAnnotation} busy={!!busy} uncertain={!!retry} onBlocked={setError} />
    <div ref={focus} className="line-scheme-dialog" onKeyDownCapture={event => {
      if (!['Delete', 'Backspace'].includes(event.key) || event.defaultPrevented) return
      const target = event.target
      if (!(target instanceof HTMLElement) || target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="combobox"]')) return
      // WebKit otherwise treats Backspace on a button as browser Back, even
      // in a child confirmation. Leave text editing and modified keys alone.
      const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      if (event.key === 'Backspace' && !modified) event.preventDefault()
      if (target.closest('[data-scheme-dimension], [data-scheme-dimension-panel]')) return
      if (event.repeat || modified || event.nativeEvent.isComposing || !editable || (!selectedPoints.length && !selectedAnnotations.length) || !isTopModalDialog(focus.current)) return
      if (!target.closest('.line-scheme-canvas, .line-scheme-joints, [data-scheme-point-tooltip]')) return
      if (isContextActionMenuOpen() || hasVisibleEscapePopup('[data-select-listbox]')) return
      event.preventDefault(); event.stopPropagation(); removeSelection()
    }}>
      <header className="line-scheme-heading">
        <div className="line-scheme-title min-w-0"><h2 className="truncate font-semibold">Схема линии {bundle?.line ?? line.line}</h2><p className="truncate text-xs text-slate-500">{bundle?.projectTitle ?? line.projectTitle} · {bundle?.subtitleCode ?? line.subtitleCode}</p></div>
        <div className="line-scheme-heading-document">
          <Select searchable popupSize="wide" aria-label="Редакция PDF" className="h-8 w-full min-w-0 text-xs" value={revisionId ?? ''} disabled={dirty || !!busy || !!retry || !revision} onChange={event => { setRevisionId(event.target.value); setPage(1); setSelectedJoint(null); setSelectedPoint(null); setFocusPoint(null) }}><option value="" disabled>Нет PDF</option>{bundle?.revisions.map(item => <option key={item.id} value={item.id}>{item.id === bundle.activeRevisionId ? 'Основной' : 'Архив'}{item.changeNumber ? ` · Изм. ${item.changeNumber}` : ''} · {item.fileName.replace(/\.pdf$/i, '')}</option>)}</Select>
          <div className="line-scheme-heading-access">
            <span title={accessText} className={`line-scheme-access ${lease.owned && current && can('schemes.edit') ? 'is-editable' : ''}`}>{accessText}</span>
            {!lease.owned && (can('schemes.edit') || can('schemes.delete')) && <Button variant="ghost" size="sm" className="line-scheme-check-access" disabled={!!busy || opening} onClick={() => void acquire()}>Проверить доступ</Button>}
          </div>
        </div>
        <div className="line-scheme-heading-actions">
          <div className="line-scheme-action-buttons">
          <Button variant="ghost" size="icon" aria-label="Обновить состояния" title={pointsQuery.data?.updatedAt ? `Обновить состояния · Данные на ${new Date(pointsQuery.data.updatedAt).toLocaleTimeString('ru-RU')}` : 'Обновить состояния'} disabled={pointsQuery.isFetching || listQuery.isFetching || updatingDraft || !!busy} onClick={refreshStates}><RefreshCw size={16} /></Button>
          <Button variant="outline" size="sm" disabled={dirty || !!busy || !!retry} title={dirty ? 'Сначала сохраните или отмените изменения разметки' : undefined} onClick={onManageFiles}><Archive size={15} /> Файлы и архив{bundle?.revisions.length ? ` (${bundle.revisions.length})` : ''}</Button>
          <Button variant="outline" size="sm" disabled={!dirty || !editable || inputDirty} title={inputDirty ? 'Сначала примените или отмените ввод' : undefined} onClick={() => void save()}><Save size={15} /> Сохранить{dirty ? ` (${changeCount + (inputDirty ? 1 : 0)})` : ''}</Button>
          <Button variant="ghost" size="icon" aria-label="Закрыть схему" disabled={!!busy} onClick={close}><X size={18} /></Button>
          </div>
          <div role={error ? 'alert' : 'status'} className={`line-scheme-feedback ${error ? 'is-error' : ''}`}>
            <span className="line-scheme-feedback-text" title={feedback || undefined}>{feedback}</span>
            {retry && !busy && <button className="shrink-0 text-sky-700 hover:underline" onClick={() => void retry()}>Повторить операцию</button>}
            {selectedJoint && !busy && <button className="shrink-0 text-sky-700 hover:underline" aria-label="Отменить размещение" onClick={() => { setSelectedJoint(null); setNotice('') }}>Отмена</button>}
            {measuring && !busy && <button className="shrink-0 text-sky-700 hover:underline" aria-label="Отменить размер" onClick={() => { setMeasuring(false); clearSelection() }}>Отмена</button>}
            {dirty && !busy && <button className="shrink-0 text-sky-700 hover:underline" onClick={() => setDiscardPrompt(true)}>Отменить изменения</button>}
          </div>
        </div>
      </header>
      <div className="line-scheme-workspace">
        <div className="line-scheme-canvas">{revision ? <Suspense fallback={<div className="p-8 text-slate-500">Загружаем просмотрщик PDF…</div>}><Pdf key={revision.id} revision={revision} page={page} onPage={value => { if (inputDirty) { setNotice('Сначала примените или отмените введённый размер.'); return }; clearSelection(); setPage(value) }} controlsTarget={pdfControls} points={visiblePoints} editable={editable && !inputDirty && !pointsQuery.isFetching && !pointsQuery.error} placing={!!selectedJoint || !!placingAnnotation} focusPoint={focusPoint} selectedIds={selectedPointIds} onPlace={addPoint} onMove={movePoint} onMenu={(point, event) => {
          setObjectMenu(null); if (!inputDirty) cancelAnnotation(selectedPointIds.has(point.id)); setMeasuring(false); setMeasureFrom(null); setSelectedJoint(null); setFocusPoint(null)
          if (!inputDirty && !selectedPointIds.has(point.id)) setSelectedPoint(point)
          const anchor = event.currentTarget, rect = anchor.getBoundingClientRect()
          setPointMenu({ id: point.id, x: 'clientX' in event ? event.clientX : rect.left, y: 'clientY' in event ? event.clientY : rect.bottom, anchorElement: anchor })
        }} onSelect={selectPoint} onClear={clearSelection} onOpen={point => inspectJoint(point.joint)}
          annotations={annotationsVisible ? visibleAnnotations : []} selectedAnnotationIds={selectedAnnotationIds} onObjectMenu={openObjectMenu} onSelectAnnotation={selectAnnotation} onMoveAnnotation={moveAnnotation} dimensionEditing={dimensionEditing}
          measuring={measuring} dimensions={dimensionsVisible ? displayedDimensions.filter(d => annotationsVisible || !d.fromAnnotationId && !d.toAnnotationId) : []} focusDimension={dimensionFocus} onEditDimension={item => editDimension(item, 'drawing')} onMoveDimension={moveDimension} /></Suspense> : <div className="m-auto max-w-md p-8 text-center text-slate-500">{opening ? 'Загружаем данные…' : can('schemes.edit') ? 'Откройте «Файлы и архив», чтобы загрузить чертёж или выбрать сохранённую редакцию.' : 'Для этой линии PDF ещё не загружен.'}</div>}
          {(pointsQuery.isFetching || pointsQuery.error || updatingDraft) && revision && <div className="line-scheme-load-note" role="status">{pointsQuery.error ? 'Не удалось загрузить точки. Нажмите «Обновить состояния».' : 'Загружаем состояния точек…'}</div>}
        </div>
        <aside className="line-scheme-joints">
          <div className="flex gap-1 border-b p-2" role="tablist" aria-label="Разметка чертежа">
            {(['joints', 'dimensions', 'annotations'] as const).map(tab => <button key={tab} id={`scheme-tab-${tab}`} role="tab" aria-selected={sideTab === tab} aria-controls={`scheme-panel-${tab}`} className={`min-w-0 flex-auto whitespace-nowrap rounded-lg px-1 py-2 text-xs font-medium ${sideTab === tab ? 'bg-sky-50 text-sky-800' : 'text-slate-500 hover:bg-slate-50'}`} onClick={() => setSideTab(tab)}>{tab === 'joints' ? 'Стыки' : tab === 'dimensions' ? 'Размеры' : 'Обозначения'} <span className="line-scheme-tab-count ml-1 text-[10px] opacity-60">{tab === 'joints' ? listQuery.data?.pages[0]?.total ?? 0 : tab === 'dimensions' ? visibleDimensions.length : visibleAnnotations.length}</span></button>)}
          </div>
          <div id="scheme-panel-joints" role="tabpanel" aria-labelledby="scheme-tab-joints" className="min-h-0 flex-1 flex-col" style={{ display: sideTab === 'joints' ? 'flex' : 'none' }}>
            <div className="space-y-3 border-b p-3"><LineSchemePanelSearch label="Поиск стыков схемы" placeholder="Номер стыка" value={text} onChange={setText} summary={`Лист ${page} · Стыков: ${listQuery.data?.pages[0]?.total ?? 0}`} /><label className="flex items-center gap-2 text-xs"><Checkbox checked={unplaced} onChange={event => setUnplaced(event.target.checked)} /> Только не размещённые</label><p className="text-[11px] text-slate-400">Ctrl / ⌘ + клик — выбрать несколько точек</p></div>
          <LineSchemeJointList items={listed} resetKey={`${revisionId}:${search}:${unplaced}`} hasMore={!!listQuery.hasNextPage} fetching={listQuery.isFetching} error={listQuery.error} onMore={loadMoreJoints} renderItem={joint => <LineSchemeJointRow joint={joint} placed={placement(joint)} placing={selectedJoint?.key === joint.key} selected={selectedJoint ? selectedJoint.key === joint.key : focusPoint ? (focusPoint.physicalId ? focusPoint.physicalId === joint.physicalId : focusPoint.rootId === joint.rootId) : selectedPoints.some(point => point.joint.key === joint.key)} onSelect={additive => jointClick(joint, additive)} onInspect={canInspect(joint) ? () => inspectJoint(joint) : undefined} />} />
          </div>
          <div id="scheme-panel-dimensions" role="tabpanel" aria-labelledby="scheme-tab-dimensions" data-scheme-dimension-panel className="min-h-0 flex-1 flex-col" style={{ display: sideTab === 'dimensions' ? 'flex' : 'none' }}>
            <LineSchemeDimensionPanel dimensions={displayedDimensions} anchors={anchors} page={page} editable={dimensionEditing.editable} measuring={measuring} measureFrom={measureFrom}
              visible={dimensionsVisible} onVisible={value => { if (dimensionInputDirty) { setNotice('Сначала примените или отмените введённый размер.'); return }; setDimensionsVisible(value) }} editing={dimensionEditing}
              onEdit={editDimension} onAdd={() => { if (annotationInputDirty) { setNotice('Сначала примените или отмените оформление.'); return }; cancelAnnotation(); clearSelection(); setDimensionsVisible(true); setAnnotationsVisible(true); setMeasuring(value => !value) }} onCancel={cancelDimension} onRemove={removeDimension} onMenu={openObjectMenu} />
          </div>
          <div id="scheme-panel-annotations" role="tabpanel" aria-labelledby="scheme-tab-annotations" data-scheme-annotation-panel className="min-h-0 flex-1 flex-col" style={{ display: sideTab === 'annotations' ? 'flex' : 'none' }}>
            <LineSchemeAnnotationPanel items={visibleAnnotations} selected={selectedAnnotationIds} selectionCount={selectedCount} editor={annotationEditor} adding={addingAnnotation} placing={!!placingAnnotation} page={page} editable={dimensionEditing.editable}
              visible={annotationsVisible} onVisible={value => { if (inputDirty) { setNotice('Сначала примените или отмените ввод.'); return }; setAnnotationsVisible(value) }} onCancel={cancelAnnotation} onDirty={setAnnotationInputDirty}
              onSelect={selectAnnotation} onRemove={item => removeAnnotations([item])} onRemoveSelected={removeSelection} onMenu={openObjectMenu} onAdd={() => {
                if (inputDirty) { setNotice('Сначала примените или отмените ввод.'); return }; cancelDimension(); clearSelection(); setAnnotationsVisible(true); setAddingAnnotation(true)
                setAnnotationEditor({ id: crypto.randomUUID(), page, x: .5, y: .5, shape: 'triangle', label: '', color: '#111827', size: 24, strokeWidth: 2, rotation: 0 })
              }} onApply={item => { if (!dimensionEditing.editable) return; setAnnotationInputDirty(false); setAnnotationEditor(null); if (addingAnnotation) { setPlacingAnnotation(item); setNotice('Укажите место обозначения на чертеже.'); } else { const position = visibleAnnotations.find(a => a.id === item.id); moveAnnotation({ ...item, ...(position ? { x: position.x, y: position.y } : {}) }); setNotice('Оформление изменено. Нажмите «Сохранить».'); } }} />
          </div>
        </aside>
      </div>
      <footer className="line-scheme-footer"><div className="line-scheme-legend" aria-label="Легенда состояний">{Object.entries(SCHEME_LEGEND).map(([key, item]) => <span key={key} className="flex items-center gap-1.5 whitespace-nowrap" title={item.label}><span className="line-scheme-dot" style={{ background: item.fill, borderColor: item.stroke }}>{key === 'error' ? '!' : ''}</span>{{ planned: 'Не сварен', waiting: 'Ожидает завершения', good: 'Годен', rejected: 'Ожидает ремонта', repair: 'Ремонт · ожидает НК', inactive: 'Не действует', error: 'Проблема состояния' }[key]}</span>)}</div><div ref={setPdfControls} className="line-scheme-footer-tools" /></footer>
      <ContextActionMenu autoFocus="panel" closeOnEscapeWithModal onClose={closePointMenu} menu={pointMenu && menuPoint ? {
        ...pointMenu, heading: selectedCount > 1 ? `Выбрано объектов: ${selectedCount}` : menuPoint.joint.label, description: selectedCount > 1 ? undefined : menuPoint.joint.reason,
        items: selectedCount > 1 ? groupMenuItems : [
          { id: 'open', label: 'Открыть картину стыка', icon: ExternalLink, disabled: !canInspect(menuPoint.joint),
            title: !can('welding.view') ? 'Для картины стыка нужен просмотр сварочного журнала' : undefined,
            onSelect: () => inspectJoint(menuPoint.joint) },
          { id: 'remove', label: selectedPoints.length > 1 ? `Убрать выбранные точки (${selectedPoints.length})` : 'Убрать точку', icon: Trash2, danger: true, disabled: !editable || inputDirty || pointsQuery.isFetching || !!pointsQuery.error,
            title: !current ? 'Архив доступен только для просмотра' : !editable ? 'Редактирование недоступно' : 'Удалить отметку с чертежа; стык останется в журнале', onSelect: () => removePoints(selectedPointIds.has(menuPoint.id) ? selectedPoints : [menuPoint]) },
        ],
      } : objectMenu && objectMenuItems.length ? { ...objectMenu, heading: menuAnnotation ? selectedCount > 1 ? `Выбрано объектов: ${selectedCount}` : menuAnnotation.label : 'Размер', items: objectMenuItems } : null} />
      {discardPrompt && <ConfirmActionDialog title="Отменить изменения разметки?" description="Несохранённые изменения точек, обозначений и размеров будут отменены. Сохранённая разметка останется." confirmLabel="Отменить изменения" tone="warning" onClose={() => setDiscardPrompt(false)} onConfirm={() => { setDiscardPrompt(false); discard(); void reopen(false, true).then(refreshStates).catch(reason => setError(errorMessage(reason))) }} />}
      {closePrompt && <SchemeClosePrompt dirty={dirty} uncertain={!!retry} canSave={editable && !retry && !inputDirty} onSave={() => { setClosePrompt(false); void save(true) }} onDiscard={onClose} onCancel={() => setClosePrompt(false)} />}
    </div>
  </LargeDialogShell>
}

function SchemeClosePrompt({ dirty, uncertain, canSave, onSave, onDiscard, onCancel }: { dirty: boolean; uncertain: boolean; canSave: boolean; onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  const focus = useContainedDialogFocus(onCancel)
  return <LargeDialogShell ariaLabel="Закрыть схему?" maxWidthClassName="max-w-md" overlayClassName="z-[80] bg-slate-950/30">
    <div ref={focus} className="space-y-4 p-6"><h3 className="font-semibold">Закрыть схему?</h3>
      <p className="text-sm text-slate-600">{uncertain ? 'Результат операции не подтверждён: сервер мог уже выполнить её. Закрытие окна не отменит операцию. Вернитесь и повторите её, чтобы проверить результат.' : dirty ? 'Есть несохранённые изменения разметки. При закрытии без сохранения они будут потеряны.' : 'Изменений нет. Подтвердите закрытие окна схемы.'}</p>
      <div className="flex flex-wrap gap-2"><Button onClick={onDiscard}>{dirty && !uncertain ? 'Закрыть без сохранения' : 'Закрыть схему'}</Button>{dirty && <Button variant="outline" disabled={!canSave} onClick={onSave}>Сохранить и закрыть</Button>}<Button variant="ghost" onClick={onCancel}>Вернуться</Button></div>
      <p className="text-xs text-slate-400">{dirty && !uncertain ? 'Enter — закрыть без сохранения' : 'Enter — закрыть'} · Escape — вернуться к схеме</p>
    </div>
  </LargeDialogShell>
}
