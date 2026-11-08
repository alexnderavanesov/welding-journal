import { useLayoutEffect, type RefObject } from 'react'
import type { GridApi, IRowNode } from 'ag-grid-community'

const CONTEXT_HEIGHT = 36
const close = (a: number, b: number) => Math.abs(a - b) < 1
const clamp = (value: number, maximum: number) => Math.max(0, Math.min(value, Math.max(0, maximum)))
type Anchor = { node: IRowNode; id: string | undefined; within: number }
type Geometry = { top: number; height: number; frameHeight: number; offset: number; headerHeight: number }
// Nested adapters share the document scroll. Only the deepest current reader
// may restore its anchor after a model/height change; an ancestor's pixel within
// the same detail would otherwise override the child's actual row anchor.
const readers = new Map<HTMLElement, { atReadingPosition: boolean }>()

/** A bounded AG Grid viewport driven by the document scroll, rather than a
 * second vertical scroll area. The root occupies the complete row-model height;
 * its absolutely positioned frame follows the visible part of that space.
 * No transform: the program's real fixed headers must retain the window as their
 * containing block. Assignment dialogs deliberately do not use this adapter.
 */
export function useProgramPageScroll(root: RefObject<HTMLDivElement | null>, api: GridApi | null, enabled: boolean, stickyHeaderSelector?: string, options?: { stickyFrame?: boolean; ignoreOffscreenViewportScroll?: boolean }) {
  const stickyFrame = options?.stickyFrame ?? false
  const ignoreOffscreenViewportScroll = options?.ignoreOffscreenViewportScroll ?? false
  useLayoutEffect(() => {
    const element = root.current
    if (!enabled || !element || !api || api.isDestroyed()) return
    const stickyHeader = stickyHeaderSelector ? element.closest('[data-page-scroll-root]')?.querySelector<HTMLElement>(stickyHeaderSelector) : null
    const frame = element.querySelector<HTMLElement>(':scope > .program-grid-frame')
    const viewport = frame?.querySelector<HTMLElement>('.ag-grid-viewport')
    const header = frame?.querySelector<HTMLElement>('.ag-grid-pinned-top-rows')
    const body = frame?.querySelector<HTMLElement>('.ag-grid-scrolling-container')
    const horizontalScrollbar = frame?.querySelector<HTMLElement>('.ag-body-horizontal-scroll')
    if (!frame || !viewport || !header || !body) return
    const gridRoot = frame.querySelector('.ag-root-wrapper')
    const ownsEvent = (event: Event) => event.target instanceof Element && event.target.closest('.ag-root-wrapper') === gridRoot

    const original = {
      rootHeight: element.style.height, rootMinHeight: element.style.minHeight, rootPosition: element.style.position,
      framePosition: frame.style.position, frameTop: frame.style.top, frameHeight: frame.style.height,
      frameWidth: frame.style.width, frameMinHeight: frame.style.minHeight, viewportOverflowY: viewport.style.overflowY,
      marker: element.getAttribute('data-program-page-scroll'), rowCount: element.getAttribute('data-program-row-count'),
    }
    element.dataset.programPageScroll = 'true'
    element.style.position = 'relative'; element.style.minHeight = '0'
    frame.style.position = stickyFrame ? 'sticky' : 'absolute'; frame.style.width = '100%'; frame.style.minHeight = '0'
    // Native wheel/touch scrolling can continue to the document, while AG Grid
    // can still update scrollTop for keyboard navigation and focus visibility.
    viewport.style.overflowY = 'hidden'

    let raf = 0, disposed = false, visible = false, preserveAnchor = false, pageMoved = false
    let geometry: Geometry | null = null, anchor: Anchor | null = null
    let expectedGridTop = viewport.scrollTop, observedGridTop = viewport.scrollTop
    let observedPageTop = window.scrollY
    let expectedPageTop: number | null = null, requestedGridTop: number | null = null
    let keyboardNavigation = false, keyboardTimer = 0
    const reader = { atReadingPosition: false }
    readers.set(element, reader)
    const hasNestedReader = () => {
      for (const [nested, state] of readers) {
        if (nested !== element && state.atReadingPosition && element.contains(nested)
          && nested.isConnected && !nested.closest('[hidden]') && nested.getClientRects().length) return true
      }
      return false
    }

    const isVisible = () => element.isConnected && !element.closest('[hidden]') && !!element.getClientRects().length
    const style = (target: HTMLElement, property: 'height' | 'top', value: number) => {
      const next = `${value}px`
      if (target.style[property] !== next) target.style[property] = next
    }
    const readAnchor = (pixel: number): Anchor | null => {
      let low = 0, high = api.getDisplayedRowCount() - 1
      let node: IRowNode | undefined
      // rowTop is already maintained by AG Grid, including expanded histories.
      // Binary search avoids scanning every joint on each scroll frame.
      while (low <= high) {
        const middle = (low + high) >> 1
        const candidate = api.getDisplayedRowAtIndex(middle)
        if (!candidate || candidate.rowTop == null) break
        node = candidate
        if (pixel < candidate.rowTop) high = middle - 1
        else if (pixel >= candidate.rowTop + (candidate.rowHeight ?? 44)) low = middle + 1
        else break
      }
      return node ? { node, id: node.id, within: Math.max(0, pixel - (node.rowTop ?? 0)) } : null
    }
    const anchorPixel = () => {
      if (!anchor) return 0
      let node = anchor.id ? api.getRowNode(anchor.id) : anchor.node
      // Detail nodes are not in the client-side row-ID map. A surviving detail
      // keeps its node identity, even when rows before it have been filtered.
      if (!node && anchor.node.detail) node = anchor.node
      const displayed = (candidate: IRowNode | null | undefined): candidate is IRowNode & { rowTop: number; rowIndex: number } => candidate?.rowIndex != null && candidate.rowTop != null && api.getDisplayedRowAtIndex(candidate.rowIndex) === candidate
      if (!displayed(node)) {
        // Closing the history being read must return to that joint, rather than
        // jumping hundreds of rows to the start of the list.
        if (anchor.node.detail && displayed(anchor.node.parent)) return anchor.node.parent.rowTop!
        return 0
      }
      return node.rowTop + Math.min(anchor.within, Math.max(0, (node.rowHeight ?? 44) - 1))
    }
    const scrollPage = (top: number) => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      const next = clamp(top, maximum)
      // Safari exposes the elastic offset in scrollY. Comparing it directly to
      // a clamped destination repeatedly cancels the browser's spring at both
      // edges (every mounted grid used to force its own scrollTo).
      if (!close(clamp(window.scrollY, maximum), next)) {
        expectedPageTop = next
        window.scrollTo({ top: next, left: window.scrollX, behavior: 'instant' })
      }
      return clamp(window.scrollY, maximum)
    }
    const update = () => {
      raf = 0
      if (disposed || api.isDestroyed()) return
      if (!isVisible()) {
        reader.atReadingPosition = false
        visible = false; preserveAnchor = false; pageMoved = false; requestedGridTop = null
        return
      }
      const becomingVisible = !visible
      visible = true
      // WebKit can deliver viewport/focus work before the document scroll
      // event. Account for the page's actual native movement now, otherwise an
      // older anchor would undo scrollIntoView even after the target was focused.
      if (!close(window.scrollY, observedPageTop)) pageMoved = true
      const contextHeight = stickyHeader?.offsetHeight ?? CONTEXT_HEIGHT
      const top = element.getBoundingClientRect().top + window.scrollY
      const currentPageTop = clamp(window.scrollY, document.documentElement.scrollHeight - window.innerHeight)
      const headerHeight = header.offsetHeight
      const count = api.getDisplayedRowCount()
      element.dataset.programRowCount = String(count)
      const last = api.getDisplayedRowAtIndex(count - 1)
      const rowHeight = last ? (last.rowTop ?? 0) + (last.rowHeight ?? 44) : 64
      // AG's fake scrollbar is a sibling of its viewport. Native scrollbar
      // metrics on the viewport are zero, even with a visible non-overlay bar.
      const horizontalBar = horizontalScrollbar && !horizontalScrollbar.classList.contains('ag-scrollbar-invisible') ? horizontalScrollbar.offsetHeight : 0
      // Joint grids have no wrapper border: reserving another 2px leaves a
      // blank tail between the final joint and its enclosing workspace frame.
      const height = Math.max(headerHeight + 1, rowHeight + headerHeight + horizontalBar)
      const frameHeight = Math.min(height, Math.max(120, window.innerHeight - contextHeight))
      const maxOffset = Math.max(0, height - frameHeight)
      const wasAtReadingPosition = !!geometry && currentPageTop + contextHeight >= geometry.top - 1 && currentPageTop + contextHeight < geometry.top + geometry.height - geometry.headerHeight
      const shifted = !!geometry && !close(top, geometry.top)

      // Grow/shrink the document before clamping its scroll position. Only the
      // table under the reading position may anchor the page; offscreen/hidden
      // sibling workspaces must never move the reader while refreshing.
      style(element, 'height', height)
      style(frame, 'height', frameHeight)
      let pageTop = currentPageTop
      if (requestedGridTop != null) {
        const requested = clamp(requestedGridTop, maxOffset)
        // scrollIntoView/focus can scroll BOTH the hidden-overflow viewport and
        // the document in one browser operation. Preserve their combined move:
        // replacing it with either scroll alone would push the target back out
        // of view (notably the joint immediately above an expanded history).
        pageTop = pageMoved && geometry ? currentPageTop + requested - geometry.offset : top + requested - contextHeight
      } else if (!becomingVisible && !pageMoved && !keyboardNavigation && wasAtReadingPosition && (preserveAnchor || shifted) && !hasNestedReader()) {
        pageTop = top + clamp(anchorPixel(), maxOffset) - contextHeight
      }
      // WebKit may deliver document-focus and viewport-scroll events in a
      // different order. During keyboard navigation the current native cell
      // must remain visible even if their combined offsets were intermediate.
      // Native inputs, other grids and pointer scrolling keep their own focus.
      const active = document.activeElement
      if (keyboardNavigation && active?.classList.contains('ag-cell') && active.closest('.ag-root-wrapper') === frame.querySelector('.ag-root-wrapper')) {
        const focused = api.getFocusedCell()
        const node = focused && !focused.rowPinned ? api.getDisplayedRowAtIndex(focused.rowIndex) : undefined
        if (node?.rowTop != null && active.closest('.ag-row')?.getAttribute('row-index') === String(focused?.rowIndex)) {
          const upper = top + node.rowTop - contextHeight
          const lower = top + headerHeight + node.rowTop + (node.rowHeight ?? 44) + horizontalBar - window.innerHeight
          pageTop = lower > upper ? upper : Math.max(lower, Math.min(pageTop, upper))
        }
      }
      const layoutPageTop = scrollPage(pageTop)
      // The enclosing auto-height master/detail row is measured by AG in a
      // later frame. Growing this root does not immediately grow the document:
      // preserve an explicit navigation request until that outer height catches
      // up, instead of losing it to the old document's scroll-range clamp.
      const waitingForOuterHeight = requestedGridTop != null
        && pageTop > layoutPageTop + 1
        && top + height > document.documentElement.scrollHeight + 1
      if (!waitingForOuterHeight) requestedGridTop = null
      const offset = clamp(layoutPageTop + contextHeight - top, maxOffset)
      // Native sticky positioning follows compositor scrolling immediately.
      // Only row virtualization waits for RAF; the header never chases scrollY.
      style(frame, 'top', stickyFrame ? contextHeight : offset)
      expectedGridTop = offset
      if (!close(viewport.scrollTop, offset)) viewport.scrollTop = offset
      observedGridTop = viewport.scrollTop
      geometry = { top, height, frameHeight, offset, headerHeight }
      // Keep the last completed reading ownership while other grids resize.
      // Their new live bounds can temporarily move this reader out of the old
      // position before it gets its own animation-frame update.
      reader.atReadingPosition = layoutPageTop + contextHeight >= top - 1
        && layoutPageTop + contextHeight < top + height - headerHeight
      observedPageTop = window.scrollY
      anchor = readAnchor(offset)
      preserveAnchor = false; pageMoved = false
    }
    const schedule = () => { if (!disposed && !raf) raf = requestAnimationFrame(update) }
    const onPageScroll = () => {
      if (expectedPageTop != null && close(window.scrollY, expectedPageTop)) expectedPageTop = null
      else { expectedPageTop = null; pageMoved = true }
      schedule()
    }
    const extendKeyboardNavigation = () => {
      keyboardNavigation = true
      window.clearTimeout(keyboardTimer)
      // AG may re-run ensureIndexVisible after measuring newly reached rows.
      // Give those finite retries precedence over the old reading anchor, then
      // return to normal anchoring without polling or a permanent RAF loop.
      keyboardTimer = window.setTimeout(() => { keyboardNavigation = false }, 200)
    }
    const onNavigationKey = (event: KeyboardEvent) => {
      // Stamps can contain a second page-scroll grid. Only that inner grid
      // should interpret its keyboard/focus movement as a navigation request.
      if (!ownsEvent(event)) return
      if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) extendKeyboardNavigation()
    }
    const onPointerScroll = () => {
      keyboardNavigation = false
      requestedGridTop = null
      window.clearTimeout(keyboardTimer)
    }
    const onNewUserNavigation = () => { requestedGridTop = null }
    const onViewportScroll = () => {
      const next = viewport.scrollTop
      if (close(next, observedGridTop)) return
      observedGridTop = next
      if (!visible || !isVisible() || close(next, expectedGridTop)) return
      if (ignoreOffscreenViewportScroll && !keyboardNavigation) {
        const bounds = element.getBoundingClientRect()
        if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) {
          // A retained joint grid can clamp its internal viewport while density
          // or auto-height measurements change. That is not a request to move
          // the document. Native focus/scrollIntoView first brings its root into
          // view; keyboard navigation remains explicit. Stamps keep accepting
          // offscreen API navigation for far reveal and closing a virtual master.
          schedule()
          return
        }
      }
      // A smaller model can clamp scrollTop before its new height is measured.
      // Ignore that clamp, but preserve explicit ensureNodeVisible/focus moves
      // issued immediately after a filter or expansion changed the model.
      const clamped = preserveAnchor ? clamp(expectedGridTop, viewport.scrollHeight - viewport.clientHeight) : expectedGridTop
      if (!preserveAnchor || keyboardNavigation || !close(next, clamped)) {
        requestedGridTop = next
        if (keyboardNavigation) extendKeyboardNavigation()
      }
      schedule()
    }
    const onModelChanged = () => { preserveAnchor = true; schedule() }
    const onCellFocus = (event: FocusEvent) => { if (keyboardNavigation && ownsEvent(event)) schedule() }
    const onWindowResize = () => { preserveAnchor = true; schedule() }
    const observedHeights = new WeakMap<Element, number>()
    const heightChanged = (entries: ResizeObserverEntry[]) => entries.reduce((changed, entry) => {
      const previous = observedHeights.get(entry.target), height = entry.contentRect.height
      observedHeights.set(entry.target, height)
      return changed || previous !== height
    }, false)
    // Horizontal dragging does not change the vertical scroll geometry. Wrapped
    // content still reports a real height change through the body/header observers.
    const onRootResize = new ResizeObserver(entries => { if (heightChanged(entries)) schedule() })
    onRootResize.observe(element)
    const programPage = element.closest('[data-testid="line-program"]')
    if (programPage && programPage !== element) onRootResize.observe(programPage)
    if (stickyHeader) onRootResize.observe(stickyHeader)
    const onContentResize = new ResizeObserver(entries => { if (heightChanged(entries)) onModelChanged() })
    onContentResize.observe(body); onContentResize.observe(header)
    if (horizontalScrollbar) onContentResize.observe(horizontalScrollbar)
    // AG Grid can update explicit model height before a box resize, particularly
    // after a filter. Only the body style is relevant, not every virtual cell.
    let bodyHeight = body.style.height
    const contentMutation = new MutationObserver(() => {
      if (body.style.height !== bodyHeight) { bodyHeight = body.style.height; onModelChanged() }
    })
    contentMutation.observe(body, { attributes: true, attributeFilter: ['style'] })
    // Sticky AG headers normally consume wheel events to scroll their viewport.
    // Let the browser handle vertical wheel input on the common page instead;
    // horizontal input and column interactions keep their native behaviour.
    const onHeaderWheel = (event: WheelEvent) => {
      // Do not preventDefault: the browser owns inertial/shift-wheel scrolling.
      // Pure horizontal input does not enter AG's vertical-wheel path.
      // A shift+deltaY event must also bypass that path so the browser can
      // interpret it horizontally instead of AG scrolling the rows vertically.
      if (event.deltaY) event.stopImmediatePropagation()
    }
    header.addEventListener('wheel', onHeaderWheel, { capture: true, passive: true })
    element.addEventListener('keydown', onNavigationKey, true)
    element.addEventListener('focusin', onCellFocus)
    window.addEventListener('wheel', onPointerScroll, { capture: true, passive: true })
    viewport.addEventListener('scroll', onViewportScroll, { passive: true })
    window.addEventListener('scroll', onPageScroll, { passive: true })
    window.addEventListener('pointerdown', onNewUserNavigation, true)
    window.addEventListener('keydown', onNewUserNavigation, true)
    window.addEventListener('resize', onWindowResize)
    api.addEventListener('modelUpdated', onModelChanged)
    update()
    return () => {
      readers.delete(element)
      disposed = true; cancelAnimationFrame(raf); window.clearTimeout(keyboardTimer)
      onRootResize.disconnect(); onContentResize.disconnect(); contentMutation.disconnect()
      header.removeEventListener('wheel', onHeaderWheel, true)
      element.removeEventListener('keydown', onNavigationKey, true)
      element.removeEventListener('focusin', onCellFocus)
      window.removeEventListener('wheel', onPointerScroll, true)
      viewport.removeEventListener('scroll', onViewportScroll)
      window.removeEventListener('scroll', onPageScroll)
      window.removeEventListener('pointerdown', onNewUserNavigation, true)
      window.removeEventListener('keydown', onNewUserNavigation, true)
      window.removeEventListener('resize', onWindowResize)
      if (!api.isDestroyed()) {
        api.removeEventListener('modelUpdated', onModelChanged)
      }
      element.style.height = original.rootHeight; element.style.minHeight = original.rootMinHeight; element.style.position = original.rootPosition
      frame.style.position = original.framePosition; frame.style.top = original.frameTop; frame.style.height = original.frameHeight
      frame.style.width = original.frameWidth; frame.style.minHeight = original.frameMinHeight; viewport.style.overflowY = original.viewportOverflowY
      if (original.marker == null) element.removeAttribute('data-program-page-scroll')
      else element.setAttribute('data-program-page-scroll', original.marker)
      if (original.rowCount == null) element.removeAttribute('data-program-row-count')
      else element.setAttribute('data-program-row-count', original.rowCount)
    }
  }, [root, api, enabled, stickyHeaderSelector, stickyFrame, ignoreOffscreenViewportScroll])
}
