import { useLayoutEffect, type RefObject } from 'react'
import type { GridApi, IRowNode } from 'ag-grid-community'

const CONTEXT_HEIGHT = 36
const close = (a: number, b: number) => Math.abs(a - b) < 1
const clamp = (value: number, maximum: number) => Math.max(0, Math.min(value, Math.max(0, maximum)))
type Anchor = { node: IRowNode; id: string | undefined; within: number }
type Geometry = { top: number; height: number; frameHeight: number; offset: number; headerHeight: number }

/** A bounded AG Grid viewport driven by the document scroll, rather than a
 * second vertical scroll area. The root occupies the complete row-model height;
 * its absolutely positioned frame follows the visible part of that space.
 * No transform: the program's real fixed headers must retain the window as their
 * containing block. Assignment dialogs deliberately do not use this adapter.
 */
export function useProgramPageScroll(root: RefObject<HTMLDivElement | null>, api: GridApi | null, enabled: boolean) {
  useLayoutEffect(() => {
    const element = root.current
    if (!enabled || !element || !api || api.isDestroyed()) return
    const frame = element.querySelector<HTMLElement>(':scope > .program-grid-frame')
    const viewport = frame?.querySelector<HTMLElement>('.ag-grid-viewport')
    const header = frame?.querySelector<HTMLElement>('.ag-grid-pinned-top-rows')
    const body = frame?.querySelector<HTMLElement>('.ag-grid-scrolling-container')
    const horizontalScrollbar = frame?.querySelector<HTMLElement>('.ag-body-horizontal-scroll')
    if (!frame || !viewport || !header || !body) return

    const original = {
      rootHeight: element.style.height, rootMinHeight: element.style.minHeight, rootPosition: element.style.position,
      framePosition: frame.style.position, frameTop: frame.style.top, frameHeight: frame.style.height,
      frameWidth: frame.style.width, frameMinHeight: frame.style.minHeight, viewportOverflowY: viewport.style.overflowY,
      marker: element.getAttribute('data-program-page-scroll'), rowCount: element.getAttribute('data-program-row-count'),
    }
    element.dataset.programPageScroll = 'true'
    element.style.position = 'relative'; element.style.minHeight = '0'
    frame.style.position = 'absolute'; frame.style.width = '100%'; frame.style.minHeight = '0'
    // Native wheel/touch scrolling can continue to the document, while AG Grid
    // can still update scrollTop for keyboard navigation and focus visibility.
    viewport.style.overflowY = 'hidden'

    let raf = 0, disposed = false, visible = false, preserveAnchor = false, pageMoved = false
    let geometry: Geometry | null = null, anchor: Anchor | null = null
    let expectedGridTop = viewport.scrollTop, observedGridTop = viewport.scrollTop
    let expectedPageTop: number | null = null, requestedGridTop: number | null = null
    let keyboardNavigation = false, keyboardTimer = 0

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
      if (!close(window.scrollY, next)) {
        expectedPageTop = next
        window.scrollTo({ top: next, left: window.scrollX, behavior: 'instant' })
      }
    }
    const update = () => {
      raf = 0
      if (disposed || api.isDestroyed()) return
      if (!isVisible()) {
        visible = false; preserveAnchor = false; pageMoved = false; requestedGridTop = null
        return
      }
      const becomingVisible = !visible
      visible = true
      const top = element.getBoundingClientRect().top + window.scrollY
      const headerHeight = header.offsetHeight
      const count = api.getDisplayedRowCount()
      element.dataset.programRowCount = String(count)
      const last = api.getDisplayedRowAtIndex(count - 1)
      const rowHeight = last ? (last.rowTop ?? 0) + (last.rowHeight ?? 44) : 64
      // AG's fake scrollbar is a sibling of its viewport. Native scrollbar
      // metrics on the viewport are zero, even with a visible non-overlay bar.
      const horizontalBar = horizontalScrollbar && !horizontalScrollbar.classList.contains('ag-scrollbar-invisible') ? horizontalScrollbar.offsetHeight : 0
      const height = Math.max(headerHeight + 1, rowHeight + headerHeight + horizontalBar + 2)
      const frameHeight = Math.min(height, Math.max(120, window.innerHeight - CONTEXT_HEIGHT))
      const maxOffset = Math.max(0, height - frameHeight)
      const wasAtReadingPosition = !!geometry && window.scrollY + CONTEXT_HEIGHT >= geometry.top - 1 && window.scrollY + CONTEXT_HEIGHT < geometry.top + geometry.height - geometry.headerHeight
      const shifted = !!geometry && !close(top, geometry.top)

      // Grow/shrink the document before clamping its scroll position. Only the
      // table under the reading position may anchor the page; offscreen/hidden
      // sibling workspaces must never move the reader while refreshing.
      style(element, 'height', height)
      style(frame, 'height', frameHeight)
      if (requestedGridTop != null) {
        const requested = clamp(requestedGridTop, maxOffset)
        // scrollIntoView/focus can scroll BOTH the hidden-overflow viewport and
        // the document in one browser operation. Preserve their combined move:
        // replacing it with either scroll alone would push the target back out
        // of view (notably the joint immediately above an expanded history).
        scrollPage(pageMoved && geometry ? window.scrollY + requested - geometry.offset : top + requested - CONTEXT_HEIGHT)
      } else if (!becomingVisible && !pageMoved && !keyboardNavigation && wasAtReadingPosition && (preserveAnchor || shifted)) {
        scrollPage(top + clamp(anchorPixel(), maxOffset) - CONTEXT_HEIGHT)
      }
      requestedGridTop = null
      const offset = clamp(window.scrollY + CONTEXT_HEIGHT - top, maxOffset)
      style(frame, 'top', offset)
      expectedGridTop = offset
      if (!close(viewport.scrollTop, offset)) viewport.scrollTop = offset
      observedGridTop = viewport.scrollTop
      geometry = { top, height, frameHeight, offset, headerHeight }
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
      if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) extendKeyboardNavigation()
    }
    const onPointerScroll = () => {
      keyboardNavigation = false
      window.clearTimeout(keyboardTimer)
    }
    const onViewportScroll = () => {
      const next = viewport.scrollTop
      if (close(next, observedGridTop)) return
      observedGridTop = next
      if (!visible || !isVisible() || close(next, expectedGridTop)) return
      // A model update can clamp scrollTop before its new height is measured.
      // Preserve the known row anchor instead of interpreting that as navigation.
      if (!preserveAnchor || keyboardNavigation) {
        requestedGridTop = next
        if (keyboardNavigation) extendKeyboardNavigation()
      }
      schedule()
    }
    const onModelChanged = () => { preserveAnchor = true; schedule() }
    const onWindowResize = () => { preserveAnchor = true; schedule() }
    const onRootResize = new ResizeObserver(schedule)
    onRootResize.observe(element)
    const onContentResize = new ResizeObserver(onModelChanged)
    onContentResize.observe(body); onContentResize.observe(header)
    if (horizontalScrollbar) onContentResize.observe(horizontalScrollbar)
    // AG Grid can update explicit model height before a box resize, particularly
    // after a filter. Only the body style is relevant, not every virtual cell.
    const contentMutation = new MutationObserver(onModelChanged)
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
    element.addEventListener('wheel', onPointerScroll, { capture: true, passive: true })
    viewport.addEventListener('scroll', onViewportScroll, { passive: true })
    window.addEventListener('scroll', onPageScroll, { passive: true })
    window.addEventListener('resize', onWindowResize)
    api.addEventListener('modelUpdated', onModelChanged)
    update()
    return () => {
      disposed = true; cancelAnimationFrame(raf); window.clearTimeout(keyboardTimer)
      onRootResize.disconnect(); onContentResize.disconnect(); contentMutation.disconnect()
      header.removeEventListener('wheel', onHeaderWheel, true)
      element.removeEventListener('keydown', onNavigationKey, true)
      element.removeEventListener('wheel', onPointerScroll, true)
      viewport.removeEventListener('scroll', onViewportScroll)
      window.removeEventListener('scroll', onPageScroll)
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
  }, [root, api, enabled])
}
