import { useEffect, useId, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** One tooltip for the viewport, rather than a portal/timer for every cell. */
export function JournalCellTooltip({ frame, enabled }: { frame: RefObject<HTMLDivElement | null>; enabled: boolean }) {
  const id = useId()
  const [tip, setTip] = useState<{ title: string; body: string; left: number; top: number } | null>(null)
  useEffect(() => {
    const root = frame.current
    if (!enabled || !root) return
    let anchor: HTMLElement | null = null
    let shown = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const close = () => {
      clearTimeout(timer)
      if (anchor?.getAttribute('aria-describedby') === id) anchor.removeAttribute('aria-describedby')
      anchor = null
      shown = false
      setTip(null)
    }
    const enter = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-journal-tip-title]') : null
      if (!target || target === anchor) return
      close(); anchor = target
      timer = setTimeout(() => {
        if (!target.isConnected || anchor !== target) return
        const rect = target.getBoundingClientRect()
        target.setAttribute('aria-describedby', id)
        shown = true
        setTip({ title: target.dataset.journalTipTitle ?? '', body: target.dataset.journalTipBody ?? '',
          left: Math.max(12, Math.min(rect.left, innerWidth - 332)), top: Math.max(12, Math.min(rect.bottom + 8, innerHeight - 200)) })
      }, event.type === 'focusin' ? 0 : 450)
    }
    const leave = (event: MouseEvent | FocusEvent) => {
      if (anchor && event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return
      close()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !shown) return
      event.preventDefault(); event.stopPropagation(); close()
    }
    root.addEventListener('mouseover', enter)
    root.addEventListener('focusin', enter)
    root.addEventListener('mouseout', leave)
    root.addEventListener('focusout', leave)
    root.addEventListener('pointerdown', close)
    window.addEventListener('scroll', close, { capture: true, passive: true })
    window.addEventListener('resize', close)
    window.addEventListener('keydown', key, true)
    return () => {
      close()
      root.removeEventListener('mouseover', enter); root.removeEventListener('focusin', enter)
      root.removeEventListener('mouseout', leave); root.removeEventListener('focusout', leave)
      root.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', key, true)
    }
  }, [enabled, frame, id])
  return tip ? createPortal(<div id={id} role="tooltip" className="journal-cell-tooltip" style={{ left: tip.left, top: tip.top }}>
    <strong>{tip.title}</strong><p>{tip.body}</p>
  </div>, document.body) : null
}
