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
) {
  useEffect(() => {
    const track = trackRef.current, stage = stageRef.current, frame = frameRef.current
    const viewport = frame?.querySelector<HTMLElement>('.ag-grid-viewport')
    const area = viewport?.querySelector<HTMLElement>('.ag-grid-scrollable-area')
    if (!enabled || !api || !track || !stage || !frame || !viewport || !area) return
    const body = area.querySelector<HTMLElement>('.ag-grid-scrolling-rows')
    const rows = body?.querySelector<HTMLElement>('.ag-grid-scrolling-container')
    const nativeMotion = Boolean(body && rows && typeof CSS !== 'undefined'
      && CSS.supports?.('animation-timeline', 'scroll(root block)') && CSS.supports?.('animation-range', '1px 2px'))
    let raf = 0, expectedTop = viewport.scrollTop, extent = 0, height = 0, top = 0, range = 0
    let counterTop = Number.NaN
    const origin = () => track.getBoundingClientRect().top + window.scrollY
    const stageSize = () => Math.max(180, window.innerHeight - Math.max(0, top - window.scrollY) - 12)
    const syncCounter = (actualTop: number) => {
      if (!nativeMotion || counterTop === actualTop) return
      // Cancel the inner viewport's JS-controlled offset. The outer body then
      // follows document scrolling on the compositor, including frames between
      // scroll events. No easing, delayed input, or per-row work is involved.
      counterTop = actualTop
      rows!.style.translate = `0 ${actualTop}px`
    }
    const moveRows = () => {
      expectedTop = Math.min(range, Math.max(0, window.scrollY - top))
      let actualTop = viewport.scrollTop
      if (Math.abs(actualTop - expectedTop) > .5) { viewport.scrollTop = expectedTop; actualTop = viewport.scrollTop }
      syncCounter(actualTop)
    }
    const sync = () => {
      raf = 0
      top = origin()
      // Grow the visible table into the space released by the page heading.
      const stageHeight = stageSize()
      const size = `${stageHeight}px`
      if (stage.style.height !== size) stage.style.height = size
      extent = viewport.scrollHeight; height = viewport.clientHeight
      range = Math.max(0, extent - height)
      viewport.toggleAttribute('data-journal-scrollable', range > 0)
      const trackHeight = `${stageHeight + range}px`
      if (track.style.height !== trackHeight) track.style.height = trackHeight
      if (nativeMotion) {
        body!.toggleAttribute('data-journal-native-scroll', range > 0)
        const distance = `${range}px`, interval = `${top}px ${top + range}px`
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
      moveRows()
      if (stage.style.height !== `${stageSize()}px`) schedule()
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
      const clampedTop = Math.min(expectedTop, Math.max(0, viewport.scrollHeight - viewport.clientHeight))
      if (Math.abs(actualTop - clampedTop) <= 1) { schedule(); return }
      expectedTop = viewport.scrollTop
      window.scrollTo({ top: top + expectedTop, behavior: 'instant' })
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
    const resize = new ResizeObserver(entries => {
      let heightChanged = false
      for (const entry of entries) {
        const next = entry.contentRect.height
        if (observedHeights.get(entry.target) !== next) heightChanged = true
        observedHeights.set(entry.target, next)
      }
      if (heightChanged) schedule()
    })
    resize.observe(area)
    resize.observe(viewport)
    resize.observe(track.closest('[data-scroll-top-boundary]') ?? track)
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
      viewport.removeAttribute('data-journal-scrollable')
      if (nativeMotion) {
        body!.removeAttribute('data-journal-native-scroll')
        body!.style.removeProperty('--journal-scroll-distance'); body!.style.removeProperty('animation-range')
        rows!.style.removeProperty('translate')
      }
    }
  }, [api, enabled, frameRef, stageRef, trackRef])
}
