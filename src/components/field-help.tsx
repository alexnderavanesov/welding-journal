import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

export function FieldHelp({ label, children, href }: { label: string; children: ReactNode; href?: string }) {
  const id = useId()
  const button = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const [pinned, setPinned] = useState(false)
  const open = Boolean(position)
  const show = () => {
    if (!button.current) return
    const rect = button.current.getBoundingClientRect()
    const above = rect.top > window.innerHeight / 2
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), top: above ? rect.top - 8 : rect.bottom + 8, above })
  }
  const close = () => { setPosition(null); setPinned(false) }
  useEffect(() => {
    if (!open) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    const outside = (event: PointerEvent) => { if (!button.current?.contains(event.target as Node)) close() }
    window.addEventListener('keydown', dismiss, true)
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', dismiss, true)
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])
  const Trigger = href ? 'a' : 'button'
  return <span ref={button} className="inline-flex shrink-0">
    <Trigger type={href ? undefined : 'button'} href={href} target={href ? '_blank' : undefined} rel={href ? 'noreferrer' : undefined} aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={() => { if (!pinned) setPosition(null) }} onFocus={show} onBlur={close}
      onClick={event => { event.stopPropagation(); if (href) return; if (pinned) close(); else { setPinned(true); show() } }}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
      <Info aria-hidden="true" className="h-3.5 w-3.5" />
    </Trigger>
    {position ? createPortal(<div id={id} role="tooltip" data-workflow-result-tooltip="true"
      className="pointer-events-none fixed z-[300] w-80 max-w-[calc(100vw-16px)] rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-normal leading-5 text-white shadow-lg"
      style={{ left: position.left, top: position.top, transform: position.above ? 'translateY(-100%)' : undefined }}>
      {children}
    </div>, document.body) : null}
  </span>
}
