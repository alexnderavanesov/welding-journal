import { useEffect, type RefObject } from 'react'

/** Pin the real AG header without chasing document scrolling with translate.
 * A spacer keeps its layout height; horizontal clipping preserves the live
 * filters, resize handles and column alignment in this bounded auto-height grid. */
export function useSchemeRegistryHeader(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current
    if (!element) return
    let frame = 0, header: HTMLElement | null = null, spacer: HTMLElement | null = null
    const reset = () => {
      header?.classList.remove('scheme-stuck-header')
      for (const name of ['top', 'left', 'width', 'clip-left', 'clip-right', 'scroll-left', 'scroll-right']) header?.style.removeProperty(`--scheme-header-${name}`)
      spacer?.remove(); spacer = null
    }
    const update = () => {
      frame = 0
      const next = element.querySelector<HTMLElement>('.ag-grid-pinned-top-rows')
      const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')
      const area = element.querySelector<HTMLElement>('.ag-grid-scrollable-area')
      if (next !== header) {
        reset(); observer.disconnect(); observer.observe(element); header = next
        if (header) observer.observe(header)
        if (viewport) observer.observe(viewport)
        if (area) observer.observe(area)
      }
      if (!header || !viewport || !area) return
      const bounds = area.getBoundingClientRect(), height = header.offsetHeight
      if (bounds.top >= 0 || bounds.bottom <= 0) { reset(); return }
      if (!spacer) {
        spacer = document.createElement('div')
        spacer.className = 'scheme-header-spacer'; spacer.setAttribute('aria-hidden', 'true')
        spacer.style.height = `${height}px`
        header.before(spacer); header.classList.add('scheme-stuck-header')
      }
      const view = viewport.getBoundingClientRect()
      const left = view.left + viewport.clientLeft - viewport.scrollLeft
      const width = bounds.width
      const visibleLeft = Math.max(0, view.left + viewport.clientLeft)
      const visibleRight = Math.min(window.innerWidth, view.left + viewport.clientLeft + viewport.clientWidth)
      const values = {
        top: Math.min(0, bounds.bottom - height), left, width,
        'clip-left': Math.max(0, visibleLeft - left), 'clip-right': Math.max(0, left + width - visibleRight),
        'scroll-left': view.left + viewport.clientLeft - left,
        'scroll-right': view.left + viewport.clientLeft + viewport.clientWidth - (left + width),
      }
      for (const [name, value] of Object.entries(values)) {
        const property = `--scheme-header-${name}`, next = `${value}px`
        if (header.style.getPropertyValue(property) !== next) header.style.setProperty(property, next)
      }
      if (spacer.style.height !== `${height}px`) spacer.style.height = `${height}px`
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame); reset()
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule)
    }
  }, [root])
}
