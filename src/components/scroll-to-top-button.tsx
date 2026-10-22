import { ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const SHOW_AFTER_PX = 480

export function ScrollToTopButton({ resetKey, stableHorizontalBoundary = false }: { resetKey?: string; stableHorizontalBoundary?: boolean }) {
  const [isVisible, setIsVisible] = useState(false)
  const [rightInset, setRightInset] = useState(16)
  const scrollTargetRef = useRef<Window | HTMLElement | null>(null)

  useEffect(() => {
    scrollTargetRef.current = window
    let pageX = window.scrollX
    let visible = false, observedBoundary: Element | null = null, boundaryWidth = -1
    let resize: ResizeObserver | null = null
    const updatePosition = () => {
      const target = scrollTargetRef.current
      const boundary = target instanceof HTMLElement ? target : document.querySelector('[data-scroll-top-boundary]')
      if (boundary !== observedBoundary) {
        resize?.disconnect(); observedBoundary = boundary; boundaryWidth = -1
        if (boundary) resize?.observe(boundary)
      }
      const rect = boundary?.getBoundingClientRect()
      // Stay inside the report panel, including its outer gutter; wide tables may extend off-screen.
      setRightInset(rect && rect.width > 0 ? Math.max(16, window.innerWidth - Math.min(window.innerWidth, rect.right) + 16) : 16)
    }
    const updateWindowVisibility = () => {
      const targetChanged = scrollTargetRef.current !== window
      scrollTargetRef.current = window
      const nextVisible = window.scrollY > SHOW_AFTER_PX
      setIsVisible(nextVisible)
      const nextX = window.scrollX
      if (!stableHorizontalBoundary || targetChanged || nextX !== pageX || nextVisible !== visible) updatePosition()
      pageX = nextX; visible = nextVisible
    }
    const updateContainerVisibility = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.matches('[data-page-scroll-container]')) return

      scrollTargetRef.current = target
      setIsVisible(target.scrollTop > SHOW_AFTER_PX)
      updatePosition()
    }

    // Only the journal opts in. Height changes during virtual-row loading do
    // not affect the right gutter; width/viewport changes still remeasure it.
    resize = stableHorizontalBoundary ? new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined && width !== boundaryWidth) { boundaryWidth = width; updatePosition() }
    }) : null
    if (stableHorizontalBoundary) updatePosition()
    updateWindowVisibility()
    window.addEventListener('scroll', updateWindowVisibility, { passive: true })
    window.addEventListener('resize', updatePosition, { passive: true })
    document.addEventListener('scroll', updateContainerVisibility, { capture: true, passive: true })
    return () => {
      window.removeEventListener('scroll', updateWindowVisibility)
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updateContainerVisibility, { capture: true })
      resize?.disconnect()
    }
  }, [resetKey, stableHorizontalBoundary])

  if (!isVisible) return null

  return (
    <button
      type="button"
      className="fixed bottom-5 z-[60] flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 md:bottom-6"
      style={{ right: rightInset }}
      aria-label="Вернуться в начало страницы"
      title="Наверх"
      onClick={() => {
        const target = scrollTargetRef.current
        if (target instanceof HTMLElement) {
          target.scrollTo({ left: target.scrollLeft, top: 0, behavior: 'smooth' })
          return
        }
        window.scrollTo({ left: window.scrollX, top: 0, behavior: 'smooth' })
      }}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}
