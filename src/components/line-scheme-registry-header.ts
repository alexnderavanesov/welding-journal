import { useEffect, type RefObject } from 'react'

/** Keep AG's actual header (including filters/resizers) above this bounded
 * auto-height page. Its own horizontal scrolling and column widths stay intact. */
export function useSchemeRegistryHeader(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current
    if (!element) return
    let frame = 0, top = 0, travel = 0, header: HTMLElement | null = null
    const draw = () => {
      frame = 0
      if (header) header.style.translate = `0 ${Math.min(travel, Math.max(0, window.scrollY - top))}px`
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw) }
    const measure = () => {
      const area = element.querySelector<HTMLElement>('.ag-grid-scrollable-area')
      header = element.querySelector<HTMLElement>('.ag-grid-pinned-top-rows')
      if (!area || !header) return
      top = area.getBoundingClientRect().top + window.scrollY
      travel = Math.max(0, area.offsetHeight - header.offsetHeight)
      schedule()
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', measure)
      if (header) header.style.removeProperty('translate')
    }
  }, [root])
}
