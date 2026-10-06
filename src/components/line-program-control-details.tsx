import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, MoreHorizontal } from 'lucide-react'
import type { ProgramScopeMenuEvent } from './line-program-scope-menu'

type Props = { approved: number; additional: number; onApproved: () => void; onAdditional: () => void; onOpenMenu?: (event: ProgramScopeMenuEvent) => void }

export function ProgramControlDetails({ labeled = false, ...props }: Props & { labeled?: boolean }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus() }
  if (!props.approved && !props.additional) return null
  return <>
    <button ref={trigger} type="button" aria-label="Ещё показатели контроля" title="Ещё: согласованный и дополнительный контроль" aria-haspopup="dialog" aria-expanded={open}
      className={`flex h-7 shrink-0 items-center justify-center rounded-md hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${labeled ? 'w-14 gap-1 border border-slate-200 bg-white text-xs text-slate-500' : 'w-7 text-slate-400'}`}
      onClick={() => setOpen(value => !value)}>{labeled ? <>Ещё<ChevronDown aria-hidden="true" className="h-3 w-3" /></> : <MoreHorizontal aria-hidden="true" className="h-4 w-4" />}</button>
    {open ? <ControlDetailsPopover {...props} trigger={trigger} onClose={close} /> : null}
  </>
}

function ControlDetailsPopover({ approved, additional, onApproved, onAdditional, onOpenMenu, trigger, onClose }: Props & {
  trigger: RefObject<HTMLButtonElement | null>; onClose: (restoreFocus?: boolean) => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    const anchor = trigger.current?.getBoundingClientRect(), element = panel.current
    if (!anchor || !element) return
    const rect = element.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8)),
      top: Math.max(8, anchor.bottom + rect.height + 12 <= window.innerHeight ? anchor.bottom + 4 : anchor.top - rect.height - 4),
    })
    // Focusing a newly positioned portal must not scroll the page and dismiss itself.
    element.querySelector('button')?.focus({ preventScroll: true })
  }, [trigger])
  useLayoutEffect(() => {
    const anchor = trigger.current?.getBoundingClientRect()
    const dismiss = () => onClose()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) onClose()
    }
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return
      const current = trigger.current?.getBoundingClientRect()
      // A scroll that brought the trigger into view can arrive after its click.
      // Dismiss only when scrolling actually moves our already-positioned anchor.
      if (!anchor || !current || Math.abs(current.top - anchor.top) > 0.5 || Math.abs(current.left - anchor.left) > 0.5) onClose()
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [onClose, trigger])
  const select = (action: () => void) => { onClose(true); action() }
  return createPortal(<div ref={panel} role="dialog" aria-label="Другие показатели контроля" style={position}
    className="fixed z-50 max-h-[calc(100vh-16px)] w-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/10"
    onClick={event => event.stopPropagation()}
    onContextMenu={onOpenMenu}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true) } else onOpenMenu?.(event) }}
    onBlur={event => {
      // A mouse click need not focus the next button (notably in Safari/macOS).
      // Keep a null-target blur alive until click; outside pointers/window blur
      // already dismiss the panel, while a real keyboard focus exit closes here.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) onClose()
    }}>
    <p className="px-2 py-1.5 text-xs text-slate-500">Отдельно от показателя «Лишнее»</p>
    {approved > 0 ? <button type="button" data-program-slice="approved" aria-label={`Согласовано: ${approved}`} onClick={() => select(onApproved)} className="block w-full rounded-md px-2 py-2 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500">
      <span className="flex items-baseline justify-between gap-3 text-sm text-slate-700"><span>Согласовано</span><span className="tabular-nums">{approved}</span></span>
      <span className="mt-0.5 block text-xs leading-4 text-slate-500">Показать согласованные превышения</span>
    </button> : null}
    {additional > 0 ? <button type="button" data-program-slice="additional" aria-label={`Дополнительные стыки: ${additional}`} onClick={() => select(onAdditional)} className="block w-full rounded-md px-2 py-2 text-left hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500">
      <span className="flex items-baseline justify-between gap-3 text-sm text-sky-700"><span>Дополнительные стыки</span><span className="tabular-nums">{additional}</span></span>
      <span className="mt-0.5 block text-xs leading-4 text-slate-500">Учитываются в норме, не входят в «Лишнее»</span>
    </button> : null}
  </div>, document.body)
}
