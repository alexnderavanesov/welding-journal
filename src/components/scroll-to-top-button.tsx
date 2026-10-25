import { ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const SHOW_AFTER_PX = 480

export function ScrollToTopButton({ resetKey }: { resetKey?: string }) {
  const [isVisible, setIsVisible] = useState(false)
  const scrollTargetRef = useRef<Window | HTMLElement | null>(null)

  useEffect(() => {
    scrollTargetRef.current = window
    const updateWindowVisibility = () => {
      scrollTargetRef.current = window
      setIsVisible(window.scrollY > SHOW_AFTER_PX)
    }
    const updateContainerVisibility = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.matches('[data-page-scroll-container]')) return

      scrollTargetRef.current = target
      setIsVisible(target.scrollTop > SHOW_AFTER_PX)
    }

    updateWindowVisibility()
    window.addEventListener('scroll', updateWindowVisibility, { passive: true })
    document.addEventListener('scroll', updateContainerVisibility, { capture: true, passive: true })
    return () => {
      window.removeEventListener('scroll', updateWindowVisibility)
      document.removeEventListener('scroll', updateContainerVisibility, { capture: true })
    }
  }, [resetKey])

  if (!isVisible) return null

  return (
    <button
      type="button"
      className="app-sidebar-item flex items-center rounded-xl bg-sky-50 text-left text-sm font-medium text-sky-700 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
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
      <ArrowUp className="app-sidebar-icon h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      <span className="app-sidebar-label"><span>Наверх</span></span>
    </button>
  )
}
