import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { GridApi, IRowNode } from 'ag-grid-community'
import { documentGridPathKey, writeDocumentGridSession, type DocumentGridBreadcrumb, type DocumentGridSession } from './document-history-grid-session'

export function documentGridNodePath<T>(node: IRowNode<T>) {
  const path: string[] = []
  let current: IRowNode<T> | null = node
  while (current && current.level >= 0) { if (current.group && current.key != null) path.unshift(String(current.key)); current = current.parent }
  return path
}

function hasLoadingBlocks<T>(grid: GridApi<T>) {
  const states = grid.getCacheBlockState?.() as Record<string, { pageStatus?: string }> | undefined
  const values = Object.values(states ?? {})
  // SSRM retains offscreen stubs that it need not load. Waiting for all such
  // blocks would deadlock a distant restoration after the first block is evicted.
  return values.some(state => state.pageStatus === 'loading') || values.some(state => state.pageStatus === 'needsLoading') && Boolean(grid.getRenderedNodes?.().some(node => node.stub))
}

type BlockAccess<T> = {
  load: (route: string[], startRow: number) => Promise<{ rows: T[]; rowCount: number }>
  getRowId: (row: T) => string
}

export function useDocumentGridSession<T>(
  api: GridApi<T> | null, frame: RefObject<HTMLDivElement | null>, viewId: string,
  scope: string, search: string, initial: DocumentGridSession, navigation: boolean, blocks?: BlockAccess<T>,
) {
  const matching = initial.scope === scope && !navigation
  const initialRowCount = useRef(matching ? Math.max(100, initial.firstRow + 100) : 100)
  const pending = useRef<DocumentGridSession | null>(matching ? initial : null)
  const expanded = useRef(new Map((matching ? initial.expandedPaths : []).map(path => [documentGridPathKey(path), path])))
  const sources = useRef(new WeakMap<object, DocumentGridBreadcrumb>())
  const walking = useRef(false), failed = useRef(false), sawScrollEnd = useRef(false)
  const expectedPosition = useRef<{ session: DocumentGridSession; top: number; left: number } | null>(null)
  const current = useRef({ api, scope, search, navigation, blocks }); current.current = { api, scope, search, navigation, blocks }
  const previousScope = useRef(scope), previousSearch = useRef(search), scheduled = useRef(0)
  if (previousScope.current !== scope || previousSearch.current !== search) {
    pending.current = null; expanded.current.clear(); sources.current = new WeakMap(); failed.current = false
    previousScope.current = scope; previousSearch.current = search
  }
  const rememberRows = useCallback((route: string[], startRow: number, rows: T[]) => {
    const access = current.current.blocks
    if (!access) return
    rows.forEach((row, offset) => {
      const id = access.getRowId(row)
      if (row && typeof row === 'object') sources.current.set(row, { id, route: [...route], index: startRow + offset })
    })
    // Metadata lives exactly as long as its loaded row object; evicted blocks are collectible.
    // A retained ancestor remains restorable even after scrolling through thousands of children.
    failed.current = false
  }, [])
  const capture = useCallback(() => {
    const { api: grid, scope: activeScope, search: activeSearch, navigation: activeNavigation } = current.current
    if (!grid || grid.isDestroyed() || pending.current || activeNavigation) return
    const element = frame.current, viewport = element?.querySelector<HTMLElement>('.ag-grid-viewport')
    // React cleanup can run after the frame was removed. Never overwrite a live
    // pre-destroy snapshot with zero scroll coordinates from a missing viewport.
    if (!element || !viewport) return
    const viewportRect = viewport.getBoundingClientRect(), header = element.querySelector('.ag-header')?.getBoundingClientRect()
    const navigation = document.querySelector('[data-documents-navigation]')?.getBoundingClientRect()
    const top = Math.max(0, viewportRect.top, header?.bottom ?? 0, navigation?.bottom ?? 0), bottom = Math.min(viewportRect.bottom, window.innerHeight)
    // AG's first displayed index includes buffered, invisible rows. Anchor the
    // actual visible row instead, including clipping by the sticky navigation.
    const visible = Array.from(element.querySelectorAll<HTMLElement>('.ag-row[row-id]'))
      .map(row => ({ id: row.getAttribute('row-id'), index: Number(row.getAttribute('row-index')), rect: row.getBoundingClientRect() }))
      .filter(row => row.rect.bottom > top + 1 && row.rect.top < bottom - 1)
      .sort((left, right) => left.rect.top - right.rect.top)[0]
    if (!visible && grid.getDisplayedRowCount() !== 0) return
    const visibleNode = visible ? grid.getDisplayedRowAtIndex(visible.index) : undefined
    const node = visibleNode
    const firstRow = node?.rowIndex ?? visible?.index ?? 0
    const clippedPixels = Math.max(0, top - Math.max(viewportRect.top, header?.bottom ?? viewportRect.top))
    if (node?.stub) return
    const breadcrumbs: DocumentGridBreadcrumb[] = []
    let ancestor = node
    while (ancestor && ancestor.level >= 0) {
      const source = ancestor.data && typeof ancestor.data === 'object' ? sources.current.get(ancestor.data) : undefined
      if (!source) { breadcrumbs.length = 0; break }
      breadcrumbs.unshift(source); ancestor = ancestor.parent ?? undefined
    }
    writeDocumentGridSession(viewId, { scope: activeScope, search: activeSearch, firstRow, rowId: node?.id ?? null,
      top: viewport.scrollTop, left: viewport.scrollLeft, offset: viewport.scrollTop - (node?.rowTop ?? 0) + clippedPixels, frameTop: element.getBoundingClientRect().top,
      breadcrumbs, expandedPaths: [...expanded.current.values()] })
  }, [frame, viewId])
  const restore = useCallback(() => {
    if (scheduled.current || !pending.current || walking.current || failed.current) return
    scheduled.current = requestAnimationFrame(() => {
      scheduled.current = 0
      const { api: grid, blocks: access } = current.current, saved = pending.current
      if (!grid || grid.isDestroyed() || !saved) return
      const known = saved.rowId ? grid.getRowNode(saved.rowId) : undefined
      if (access && saved.breadcrumbs?.length && known?.rowIndex == null) {
        walking.current = true
        const active = () => !grid.isDestroyed() && pending.current === saved && current.current.api === grid
        void (async () => {
          for (const [level, breadcrumb] of saved.breadcrumbs!.entries()) {
            if (!active()) return
            let node = grid.getRowNode(breadcrumb.id)
            if (!node || node.rowIndex == null) {
              let start = Math.floor(breadcrumb.index / 100) * 100
              let result = await access.load(breadcrumb.route, start)
              if (!active()) return
              // A registry can shrink while another tab is open. Fetch at most its new last block.
              if (result.rowCount > 0 && result.rowCount <= start) {
                start = Math.floor((result.rowCount - 1) / 100) * 100
                result = await access.load(breadcrumb.route, start)
                if (!active()) return
              }
              rememberRows(breadcrumb.route, start, result.rows)
              grid.applyServerSideRowData({ route: breadcrumb.route, startRow: start, successParams: { rowData: result.rows, rowCount: result.rowCount } })
              node = grid.getRowNode(breadcrumb.id)
              if (!node) {
                // The old anchor or an ancestor was removed: use a nearby surviving row,
                // rather than repeatedly jumping to an ID that cannot be restored.
                const replacement = result.rows[Math.max(0, Math.min(result.rows.length - 1, breadcrumb.index - start))]
                saved.rowId = replacement ? access.getRowId(replacement) : null
                saved.breadcrumbs = []; saved.offset = 0
                return
              }
            }
            if (level < saved.breadcrumbs!.length - 1 && node.group && !node.expanded) node.setExpanded(true, undefined, true)
          }
        })().catch(() => { if (active()) failed.current = true }).finally(() => {
          walking.current = false
          if (active() && !failed.current) restore()
        })
        return
      }
      const index = known?.rowIndex ?? Math.min(saved.firstRow, Math.max(0, grid.getDisplayedRowCount() - 1))
      if (saved.frameTop != null && frame.current) {
        const navigationBottom = document.querySelector('[data-documents-navigation]')?.getBoundingClientRect().bottom ?? 0
        const delta = frame.current.getBoundingClientRect().top - Math.max(navigationBottom, saved.frameTop)
        if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' })
      }
      const viewport = frame.current?.querySelector<HTMLElement>('.ag-grid-viewport'), beforeTop = viewport?.scrollTop, beforeLeft = viewport?.scrollLeft
      // A hydrated anchor already identifies the required block and pixel. A
      // second API scroll would first align its top, then race the mirrored AG
      // scrollbar against our pixel offset. Use one native movement instead.
      if (!(viewport && known?.rowTop != null)) grid.ensureIndexVisible(index, 'top')
      if (viewport) {
        viewport.scrollLeft = saved.left
        if (known?.rowTop != null && saved.offset != null) viewport.scrollTop = known.rowTop + saved.offset
        else if (index === saved.firstRow) viewport.scrollTop = saved.top
        else if (known?.rowTop != null) viewport.scrollTop = known.rowTop
      }
      const moved = beforeTop !== viewport?.scrollTop || beforeLeft !== viewport?.scrollLeft
      if (moved) sawScrollEnd.current = false
      const row = grid.getDisplayedRowAtIndex(index)
      const stores = grid.getServerSideGroupLevelState()
      const confirmedClamp = index < saved.firstRow && stores.length > 0 && stores.every(store => store.lastRowIndexKnown === true)
      // A stub requests only the relevant block. Group totals arrive one level at a time;
      // a temporary clamp is not evidence that the saved child viewport is ready.
      if ((row?.data && !row.stub || grid.getDisplayedRowCount() === 0) && (known?.rowIndex != null || index === saved.firstRow || confirmedClamp)) {
        expectedPosition.current = { session: saved, top: viewport?.scrollTop ?? 0, left: viewport?.scrollLeft ?? 0 }
        // A nonzero restoration must also survive the native scroll lifecycle.
        // SSRM may finish its automatic child block after our targeted block,
        // and the mirrored scrollbar can otherwise apply an older position.
        if (!hasLoadingBlocks(grid) && ((!expectedPosition.current.top && !expectedPosition.current.left) || !moved && sawScrollEnd.current && grid.isAnimationFrameQueueEmpty?.() !== false)) { pending.current = null; capture() }
      }
    })
  }, [capture, frame, rememberRows])
  const bodyScrollEnd = useCallback(() => {
    const { api: grid } = current.current, saved = pending.current
    if (!saved) { capture(); return }
    sawScrollEnd.current = true
    const expected = expectedPosition.current, viewport = frame.current?.querySelector<HTMLElement>('.ag-grid-viewport')
    if (!grid || grid.isDestroyed() || walking.current || failed.current || !viewport || expected?.session !== saved || hasLoadingBlocks(grid)) return
    if (Math.abs(viewport.scrollTop - expected.top) > 1 || Math.abs(viewport.scrollLeft - expected.left) > 1) { restore(); return }
    pending.current = null; capture()
  }, [capture, frame, restore])
  const groupOpened = useCallback((node: IRowNode<T>) => {
    if (!node.group) return
    const path = documentGridNodePath(node), key = documentGridPathKey(path)
    if (node.expanded) expanded.current.set(key, path)
    else for (const [candidate, value] of expanded.current) if (path.every((part, index) => value[index] === part)) expanded.current.delete(candidate)
    capture()
  }, [capture])
  const isGroupOpen = useCallback((node: IRowNode<T>) => Boolean(node.group) && (current.current.navigation || expanded.current.has(documentGridPathKey(documentGridNodePath(node)))), [])
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const cancelRestore = () => {
      if (!pending.current) return
      pending.current = null; failed.current = false
      cancelAnimationFrame(scheduled.current); scheduled.current = 0
    }
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey && (event.deltaX || event.deltaY)) cancelRestore() }
    const key = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return
      if (event.target instanceof Element && (event.target.closest('input, textarea, select, [contenteditable="true"]') || event.key === ' ' && event.target.closest('button, a[href], [role="button"]'))) return
      cancelRestore()
    }
    // Native scroll events also come from our own ensureIndexVisible/scrollTop.
    // Only a new operator gesture supersedes the pending saved-position intent.
    element.addEventListener('wheel', wheel, { capture: true, passive: true })
    element.addEventListener('touchstart', cancelRestore, { capture: true, passive: true })
    element.addEventListener('keydown', key, true)
    return () => {
      element.removeEventListener('wheel', wheel, true); element.removeEventListener('touchstart', cancelRestore, true); element.removeEventListener('keydown', key, true)
    }
  }, [frame])
  useEffect(() => () => { capture(); cancelAnimationFrame(scheduled.current) }, [capture])
  return { capture, restore, bodyScrollEnd, rememberRows, groupOpened, isGroupOpen, initialRowCount: initialRowCount.current }
}
