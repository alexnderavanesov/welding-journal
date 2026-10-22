import { useEffect, type RefObject } from 'react'

const TRANSITION_MS = 100
const ease = (progress: number) => progress * progress * (3 - 2 * progress)
const wholePixels = (value: number) => Math.trunc(value + Math.sign(value) * 1e-7)

/** Carry one continuous movement from the page heading into the native grid. */
export function useJournalPageScroll(frame: RefObject<HTMLDivElement | null>, stickyOffset = 0, enabled = true) {
  useEffect(() => {
    const element = frame.current
    if (!element || !enabled) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let attached = false, scheduled = 0, pendingY = 0, pendingX = 0
    let inputs: { x: number; y: number; start: number; progress: number }[] = []
    const detach = () => { element.removeEventListener('wheel', wheel, true); attached = false }
    const pageRoom = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight - window.scrollY)
    const sync = () => {
      const canMovePage = element.getBoundingClientRect().top > stickyOffset + 1 && pageRoom() > 0
      // Stop accepting input at the boundary, not when the gesture goes idle.
      // Otherwise every trackpad event extends the queue and keeps the entire
      // downward gesture on the main thread until a reversal cancels it.
      // Only the already accepted, finite tail finishes in flush().
      if (canMovePage && !attached) {
        element.addEventListener('wheel', wheel, { passive: false, capture: true }); attached = true
      } else if (!canMovePage && attached) detach()
    }
    const flush = (now: number) => {
      scheduled = 0
      inputs = inputs.filter(input => {
        const progress = Math.min(1, Math.max(0, (now - input.start) / TRANSITION_MS))
        const part = ease(progress) - ease(input.progress)
        pendingY += input.y * part; pendingX += input.x * part
        input.progress = progress
        return progress < 1
      })
      const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')
      if (viewport && (pendingY || pendingX)) {
        const top = Math.max(0, element.getBoundingClientRect().top - stickyOffset)
        const before = window.scrollY
        // Retain fractional pixels between frames; measure actual consumption.
        const pageDelta = wholePixels(Math.min(top, pageRoom(), pendingY))
        if (pageDelta) window.scrollBy({ top: pageDelta, behavior: 'instant' })
        const consumed = window.scrollY - before
        pendingY -= consumed
        if (top - consumed <= 1 || pageRoom() <= 0) {
          const beforeY = viewport.scrollTop, deltaY = wholePixels(pendingY)
          if (deltaY) viewport.scrollTop += deltaY
          const consumedY = viewport.scrollTop - beforeY
          pendingY -= consumedY
          if (deltaY && !consumedY) pendingY = 0
        }
        // preventDefault cancels both axes; retain diagonal trackpad movement.
        if (pendingX) {
          const beforeX = viewport.scrollLeft, deltaX = wholePixels(pendingX)
          if (deltaX) viewport.scrollLeft += deltaX
          const consumedX = viewport.scrollLeft - beforeX
          pendingX -= consumedX
          if (deltaX && !consumedX) pendingX = 0
        }
      }
      sync()
      if (inputs.length) schedule()
      else if (!attached) { pendingY = 0; pendingX = 0 }
    }
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(flush) }
    const cancelMovement = () => {
      cancelAnimationFrame(scheduled); scheduled = 0
      inputs = []; pendingY = 0; pendingX = 0
      sync()
    }
    // The blocking listener is already gone during the short handoff tail.
    // A passive observer still cancels that tail when the gesture reverses.
    const cancelOnWheelChange = (event: WheelEvent) => {
      if ((inputs.length || pendingY || pendingX) && event.deltaY < 0) cancelMovement()
    }
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.ag-grid-viewport')
        || event.target.closest('.ag-popup, .ag-menu') || event.ctrlKey || event.shiftKey
        || event.defaultPrevented || !event.cancelable || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      // A reversal is new user intent, not a reason to flush queued downward
      // movement in one jump before starting to go up.
      if (event.deltaY <= 0) { cancelMovement(); return }
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
      const x = event.deltaX * unit, y = event.deltaY * unit
      if (reducedMotion.matches) { pendingX += x; pendingY += y }
      else inputs.push({ x, y, start: performance.now(), progress: 0 })
      schedule()
    }
    sync()
    element.addEventListener('wheel', cancelOnWheelChange, { passive: true, capture: true })
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('pointerdown', cancelMovement, { passive: true, capture: true })
    window.addEventListener('keydown', cancelMovement, true)
    window.addEventListener('blur', cancelMovement)
    // Expanding/collapsing the dispatcher changes the handoff position too.
    const observer = new ResizeObserver(schedule)
    observer.observe(element.closest('[data-weld-report-grid]') ?? element)
    return () => {
      detach(); cancelAnimationFrame(scheduled); observer.disconnect()
      element.removeEventListener('wheel', cancelOnWheelChange, true)
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule)
      window.removeEventListener('pointerdown', cancelMovement, true)
      window.removeEventListener('keydown', cancelMovement, true)
      window.removeEventListener('blur', cancelMovement)
    }
  }, [frame, stickyOffset, enabled])
}
