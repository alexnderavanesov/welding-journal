import { useEffect, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import type { GridApi } from 'ag-grid-community'

/** The document owns vertical scrolling; AG Grid still owns row virtualization.
 * The track represents the grid's physical scroll extent, not one DOM node per row.
 * Keyboard navigation and range-drag scrolling also move the page.
 */
export function useJournalDocumentScroll(
  trackRef: RefObject<HTMLDivElement | null>,
  stageRef: RefObject<HTMLDivElement | null>,
  frameRef: RefObject<HTMLDivElement | null>,
  api: GridApi | null,
  enabled: boolean,
  topInset = 0,
  isRestoring?: () => boolean,
  bottomCover?: HTMLElement,
) {
  useEffect(() => {
    const track = trackRef.current, stage = stageRef.current, frame = frameRef.current
    const viewport = frame?.querySelector<HTMLElement>('.ag-grid-viewport')
    const area = viewport?.querySelector<HTMLElement>('.ag-grid-scrollable-area')
    if (!enabled || !api || !track || !stage || !frame || !viewport || !area) return
    const body = area.querySelector<HTMLElement>('.ag-grid-scrolling-rows')
    const rows = body?.querySelector<HTMLElement>('.ag-grid-scrolling-container')
    const footer = stage.querySelector<HTMLElement>(':scope > .journal-footer, :scope > .document-grid-footer')
    const boundary = track.closest<HTMLElement>('[data-scroll-top-boundary]')
    const nativeMotion = Boolean(body && rows && typeof CSS !== 'undefined'
      && CSS.supports?.('animation-timeline', 'scroll(root block)') && CSS.supports?.('animation-range', '1px 2px'))
    let raf = 0, expectedTop = viewport.scrollTop, extent = 0, height = 0, top = 0, range = 0, pageRange = 0, bottomInset = 12
    let counterTop = Number.NaN
    // Safari reports elastic positions outside the document's scroll range.
    // They must not resize the stage: on a short result a bottom bounce would
    // create real page height, feeding the next scroll event back into itself.
    // Cache bounds with layout changes, not on every ordinary scroll frame.
    const pageTop = () => Math.min(pageRange, Math.max(0, window.scrollY))
    const stageSize = () => Math.max(180, window.innerHeight - Math.max(topInset, top - pageTop()) - bottomInset)
    const syncCounter = (actualTop: number) => {
      if (!nativeMotion || counterTop === actualTop) return
      // Cancel the inner viewport's JS-controlled offset. The outer body then
      // follows document scrolling on the compositor, including frames between
      // scroll events. No easing, delayed input, or per-row work is involved.
      counterTop = actualTop
      rows!.style.translate = `0 ${actualTop}px`
    }
    const moveRows = () => {
      // A saved nested anchor is restored one store at a time. Its temporary
      // page height must not scroll AG through unrelated intermediate blocks.
      if (isRestoring?.()) { syncCounter(viewport.scrollTop); return }
      expectedTop = Math.min(range, Math.max(0, pageTop() + topInset - top))
      let actualTop = viewport.scrollTop
      if (Math.abs(actualTop - expectedTop) > .5) { viewport.scrollTop = expectedTop; actualTop = viewport.scrollTop }
      syncCounter(actualTop)
    }
    const sync = () => {
      raf = 0
      const trackRect = track.getBoundingClientRect()
      top = trackRect.top + window.scrollY
      // Reports have different page padding; document registries also have a
      // surrounding border. Reserving less than their actual trailing space
      // creates a small scroll range that grows whenever the heading moves.
      if (boundary) bottomInset = Math.max(0, boundary.getBoundingClientRect().bottom - trackRect.bottom)
      pageRange = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      // Grow the visible table into the space released by the page heading.
      const stageHeight = stageSize()
      const size = `${stageHeight}px`
      if (stage.style.height !== size) stage.style.height = size
      // The compositor scrolls the page before JS can resize this stage. A
      // footer in its flex flow therefore jumps even when every RAF rect is
      // correct. Anchor the visible footer to the viewport itself, keeping its
      // space in the stage. Very short viewports retain the natural flow so the
      // footer cannot cover a heading taller than the available table area.
      if (footer) {
        const docked = stageHeight > 180 && trackRect.width > 0
        if (docked) {
          const values = { '--journal-footer-height': `${footer.offsetHeight}px`, '--journal-footer-left': `${trackRect.left}px`,
            '--journal-footer-width': `${trackRect.width}px`, '--journal-footer-bottom': `${bottomInset}px` }
          for (const [key, value] of Object.entries(values)) if (stage.style.getPropertyValue(key) !== value) stage.style.setProperty(key, value)
          if (bottomCover) {
            for (const key of ['--journal-footer-left', '--journal-footer-width', '--journal-footer-bottom'] as const) {
              if (bottomCover.style.getPropertyValue(key) !== values[key]) bottomCover.style.setProperty(key, values[key])
            }
          }
        }
        stage.toggleAttribute('data-journal-docked-footer', docked)
        bottomCover?.toggleAttribute('data-journal-docked-footer', docked)
      }
      // Measure layout, not transformed overflow. A previous row translation
      // can remain in scrollHeight after grouping a long list into short groups
      // (notably in WebKit), otherwise preserving a phantom page scroll range.
      extent = area.clientHeight; height = viewport.clientHeight
      range = Math.max(0, extent - height)
      viewport.toggleAttribute('data-journal-scrollable', range > 0)
      const trackHeight = `${stageHeight + range}px`
      if (track.style.height !== trackHeight) track.style.height = trackHeight
      pageRange = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      if (nativeMotion) {
        body!.toggleAttribute('data-journal-native-scroll', range > 0)
        const distance = `${range}px`, interval = `${top - topInset}px ${top - topInset + range}px`
        if (body!.style.getPropertyValue('--journal-scroll-distance') !== distance) body!.style.setProperty('--journal-scroll-distance', distance)
        if (body!.style.getPropertyValue('animation-range') !== interval) body!.style.setProperty('animation-range', interval)
      }
      moveRows()
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(sync) }
    const fromPage = () => {
      // Scroll events arrive before RAF. Update AG now so its virtual rows can
      // render in this frame, not one frame behind the native document scroll.
      // Only the collapsing heading needs layout; the steady path uses cached
      // geometry and never measures the full, potentially huge table track.
      if (stage.style.height !== `${stageSize()}px`) {
        // The heading and sticky stage have already moved with this event.
        // Deferring their matching height to RAF leaves the footer at its old
        // position for a painted frame, especially in installed Safari.
        cancelAnimationFrame(raf)
        sync()
      } else moveRows()
    }
    const fromGrid = () => {
      const actualTop = viewport.scrollTop
      syncCounter(actualTop)
      // Sticky group handoffs replace row controllers. AG intentionally queues
      // their React commit, which can leave a blank strip for a painted frame.
      // Finish the bounded visible-row work before this scroll frame is painted.
      if (api.getRowGroupColumns().length) {
        flushSync(() => api.flushAllAnimationFrames())
        // Returning sticky rows mount during that commit. Their cell creation
        // is then queued by AG, so finish that new work too, before painting.
        // One conditional follow-up; never spin/drain an unbounded work loop.
        if (!api.isAnimationFrameQueueEmpty()) flushSync(() => api.flushAllAnimationFrames())
      }
      // The usual event only acknowledges moveRows(). Measuring scrollHeight
      // here, after the React commit, forces a fresh layout on every scroll
      // frame. Model/ResizeObserver callbacks already track extent changes.
      if (Math.abs(actualTop - expectedTop) <= 1) return
      // Ignore the browser's clamp after a smaller model, but don't discard a
      // keyboard/programmatic move just because a layout frame is pending.
      const clampedTop = Math.min(expectedTop, Math.max(0, area.clientHeight - viewport.clientHeight))
      if (Math.abs(actualTop - clampedTop) <= 1) { schedule(); return }
      expectedTop = viewport.scrollTop
      window.scrollTo({ top: top - topInset + expectedTop, behavior: 'instant' })
      schedule()
    }
    const fromHeading = (event: WheelEvent) => {
      // AG forwards wheel over its sticky header directly into its viewport.
      // Let the browser scroll the document instead, just as it does over rows.
      if (event.target instanceof Element && event.target.closest('.ag-grid-pinned-top-rows')
        && !event.target.closest('.ag-popup, .ag-menu')) event.stopPropagation()
    }
    // Column dragging changes the area's width on every step. Vertical page
    // geometry depends on heights only; measuring it after each width write
    // unnecessarily forces layout across the visible and sticky group rows.
    // Window resize still schedules explicitly; heading/content reflow and
    // scrollbar appearance change an observed content height.
    const observedHeights = new WeakMap<Element, number>()
    let observedTrackWidth = 0
    const resize = new ResizeObserver(entries => {
      let heightChanged = false
      for (const entry of entries) {
        const next = entry.contentRect.height
        if (observedHeights.get(entry.target) !== next) heightChanged = true
        observedHeights.set(entry.target, next)
        // Sidebar changes can move/resize the footer without changing height.
        // Column widths still do not schedule page layout.
        if (entry.target === track && observedTrackWidth !== entry.contentRect.width) {
          observedTrackWidth = entry.contentRect.width; heightChanged = true
        }
      }
      if (heightChanged) schedule()
    })
    resize.observe(area)
    resize.observe(viewport)
    resize.observe(boundary ?? track)
    if (footer) { resize.observe(track); resize.observe(footer) }
    viewport.addEventListener('scroll', fromGrid, { passive: true })
    frame.addEventListener('wheel', fromHeading, { passive: true, capture: true })
    window.addEventListener('scroll', fromPage, { passive: true })
    window.addEventListener('resize', schedule)
    api.addEventListener('modelUpdated', schedule)
    sync()
    return () => {
      cancelAnimationFrame(raf); resize.disconnect()
      viewport.removeEventListener('scroll', fromGrid)
      frame.removeEventListener('wheel', fromHeading, true)
      window.removeEventListener('scroll', fromPage)
      window.removeEventListener('resize', schedule)
      if (!api.isDestroyed()) api.removeEventListener('modelUpdated', schedule)
      track.style.removeProperty('height'); stage.style.removeProperty('height')
      stage.removeAttribute('data-journal-docked-footer')
      bottomCover?.removeAttribute('data-journal-docked-footer')
      for (const key of ['left', 'width', 'bottom']) bottomCover?.style.removeProperty(`--journal-footer-${key}`)
      for (const key of ['height', 'left', 'width', 'bottom']) stage.style.removeProperty(`--journal-footer-${key}`)
      viewport.removeAttribute('data-journal-scrollable')
      if (nativeMotion) {
        body!.removeAttribute('data-journal-native-scroll')
        body!.style.removeProperty('--journal-scroll-distance'); body!.style.removeProperty('animation-range')
        rows!.style.removeProperty('translate')
      }
    }
  }, [api, enabled, frameRef, stageRef, trackRef, topInset, isRestoring, bottomCover])
}
