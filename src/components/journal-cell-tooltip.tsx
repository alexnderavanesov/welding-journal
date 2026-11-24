import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** One tooltip for the viewport, rather than a portal/timer for every cell. */
export function JournalCellTooltip({ frame, enabled }: { frame: RefObject<HTMLDivElement | null>; enabled: boolean }) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ anchor: HTMLElement; title: string; body?: string; items?: string[] } | null>(null)
  const dismiss = useRef<() => void>(() => {})
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
    dismiss.current = close
    const enter = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-journal-tip-title]') : null
      if (!target || target === anchor) return
      close(); anchor = target
      timer = setTimeout(() => {
        if (!target.isConnected || anchor !== target) return
        target.setAttribute('aria-describedby', id)
        shown = true
        setTip({ anchor: target, title: target.dataset.journalTipTitle ?? '', body: target.dataset.journalTipBody,
          items: target.dataset.journalTipList?.split('\n') })
      }, event.type === 'focusin' ? 0 : 450)
    }
    const leave = (event: MouseEvent | FocusEvent) => {
      if (event.relatedTarget instanceof Node && (anchor?.contains(event.relatedTarget) || panel.current?.contains(event.relatedTarget))) return
      close()
    }
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node && panel.current?.contains(event.target))) close()
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
    root.addEventListener('click', close)
    window.addEventListener('scroll', scroll, { capture: true, passive: true })
    window.addEventListener('resize', close)
    window.addEventListener('keydown', key, true)
    return () => {
      close()
      root.removeEventListener('mouseover', enter); root.removeEventListener('focusin', enter)
      root.removeEventListener('mouseout', leave); root.removeEventListener('focusout', leave)
      root.removeEventListener('pointerdown', close); root.removeEventListener('click', close)
      window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', key, true)
    }
  }, [enabled, frame, id])
  useLayoutEffect(() => {
    const element = panel.current
    if (!tip || !element) return
    const rect = tip.anchor.getBoundingClientRect()
    const inset = 12
    // List panels meet the cell edge so the pointer can reach and scroll long lists.
    const gap = tip.items ? 0 : 8
    const below = innerHeight - rect.bottom - gap - inset
    const above = rect.top - gap - inset
    element.style.maxHeight = tip.items ? Math.max(0, above, below) + 'px' : ''
    const { width, height } = element.getBoundingClientRect()
    const top = height <= below || below >= above ? rect.bottom + gap : rect.top - gap - height
    element.style.left = Math.max(inset, Math.min(rect.left, innerWidth - width - inset)) + 'px'
    element.style.top = Math.max(inset, Math.min(top, innerHeight - height - inset)) + 'px'
  }, [tip])
  const items = tip?.items
  return tip ? createPortal(<div ref={panel} id={id} role="tooltip" className="journal-cell-tooltip" data-position-list={items ? '' : undefined}
    onMouseLeave={event => { if (!(event.relatedTarget instanceof Node && tip.anchor.contains(event.relatedTarget))) dismiss.current() }}>
    <strong>{tip.title}</strong>
    {items ? <ol>{items.map((text, i) => <li key={i}>
      {items.length > 1 && <span className="journal-tip-number" aria-hidden="true">{i + 1}</span>}
      <span>{text}</span>
    </li>)}</ol> : <p>{tip.body}</p>}
  </div>, document.body) : null
}
