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
      className="fixed bottom-5 right-4 z-[80] flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 md:bottom-6 md:right-6"
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
