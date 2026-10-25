import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

type Choice = { value: string; label: string; disabled: boolean; group: string }
const ROW_HEIGHT = 36

function readChoices(select: HTMLSelectElement): Choice[] {
  return Array.from(select.options, option => ({ value: option.value, label: option.label,
    disabled: option.disabled || option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled,
    group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : '' }))
}

// The select retains form values, labels, validation and existing change handlers.
// Its native popup is replaced by a styled, bounded listbox.
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, onChange, onKeyDown, onMouseDown, onPointerDown, onClick, onBlur, ...props }, forwardedRef) => {
    const trigger = React.useRef<HTMLSelectElement>(null)
    const popup = React.useRef<HTMLDivElement>(null)
    const id = React.useId()
    const [open, setOpen] = React.useState(false)
    const [choices, setChoices] = React.useState<Choice[]>([])
    const [active, setActive] = React.useState(-1)
    const [scrollTop, setScrollTop] = React.useState(0)
    const [position, setPosition] = React.useState({ left: 0, top: 0, width: 0, maxHeight: 320 })
    const typed = React.useRef({ text: '', time: 0 })
    const show = () => {
      const select = trigger.current
      if (!select || select.matches(':disabled')) return
      const items = readChoices(select)
      if (!items.length) return
      setChoices(items); setActive(select.selectedIndex); setScrollTop(0)
      typed.current = { text: '', time: 0 }
      select.focus({ preventScroll: true }); setOpen(true)
      return items
    }
    const choose = (index: number) => {
      const select = trigger.current, choice = choices[index]
      if (!select || select.matches(':disabled') || !choice || choice.disabled) return
      if (select.value !== choice.value) {
        select.value = choice.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      setOpen(false)
      select.focus({ preventScroll: true })
    }
    React.useLayoutEffect(() => {
      if (!open || !trigger.current) return
      const rect = trigger.current.getBoundingClientRect()
      const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16)
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12
      const up = below < Math.min(320, choices.length * ROW_HEIGHT + 8) && above > below
      const maxHeight = Math.max(40, Math.min(320, up ? above : below))
      const height = Math.min(choices.length * ROW_HEIGHT + 8, maxHeight)
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: up ? rect.top - height - 4 : rect.bottom + 4, width, maxHeight })
    }, [open, choices.length])
    React.useLayoutEffect(() => {
      const list = popup.current
      if (!open || !list || active < 0) return
      const height = list.clientHeight || position.maxHeight
      if (active * ROW_HEIGHT < list.scrollTop) list.scrollTop = active * ROW_HEIGHT
      else if ((active + 1) * ROW_HEIGHT > list.scrollTop + height - 8) list.scrollTop = (active + 1) * ROW_HEIGHT - height + 8
      setScrollTop(list.scrollTop)
    }, [open, active, position.maxHeight])
    React.useEffect(() => { setOpen(false) }, [props.disabled, props.value])
    React.useLayoutEffect(() => {
      if (!open || !trigger.current) return
      const items = readChoices(trigger.current)
      if (trigger.current.matches(':disabled') || items.length !== choices.length || items.some((item, index) => {
        const previous = choices[index]
        return item.value !== previous.value || item.label !== previous.label || item.disabled !== previous.disabled || item.group !== previous.group
      })) setOpen(false)
    }, [children, open, choices])
    React.useEffect(() => {
      if (!open) return
      const anchor = trigger.current?.getBoundingClientRect()
      const outside = (event: PointerEvent) => {
        if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false)
      }
      const scroll = (event: Event) => {
        if (event.target instanceof Node && popup.current?.contains(event.target)) return
        const rect = trigger.current?.getBoundingClientRect()
        if (anchor && rect && Math.abs(anchor.left - rect.left) < .5 && Math.abs(anchor.top - rect.top) < .5) return
        setOpen(false)
      }
      const resize = () => setOpen(false)
      document.addEventListener('pointerdown', outside)
      window.addEventListener('scroll', scroll, true); window.addEventListener('resize', resize)
      return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize) }
    }, [open])
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3)
    const end = Math.min(choices.length, start + Math.ceil(position.maxHeight / ROW_HEIGHT) + 7)
    return <>
      <select {...props} ref={element => { trigger.current = element; if (typeof forwardedRef === 'function') forwardedRef(element); else if (forwardedRef) forwardedRef.current = element }}
        className={cn('flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm shadow-slate-200/40 outline-none hover:border-sky-300 focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 disabled:opacity-70', props.value === '' ? 'text-slate-400' : 'text-slate-800', className)}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        onChange={event => { setOpen(false); onChange?.(event) }}
        onPointerDown={event => { onPointerDown?.(event); if (event.button !== 0 || event.defaultPrevented) return; event.preventDefault(); if (open) setOpen(false); else show() }}
        onMouseDown={event => { onMouseDown?.(event); event.preventDefault() }}
        onClick={event => { onClick?.(event); event.preventDefault(); if (event.detail === 0 && !open) show() }}
        onBlur={event => { if (!popup.current?.contains(event.relatedTarget as Node)) setOpen(false); onBlur?.(event) }}
        onKeyDown={event => {
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
          if (event.key === 'Tab') { setOpen(false); onKeyDown?.(event); return }
          const navigation = ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
          const activation = event.key === 'Enter' || event.key === ' ' || event.key === 'F4'
          if (navigation || activation) {
            event.preventDefault(); event.stopPropagation()
            if (event.repeat && activation) return
            if (!open) { show(); return }
            if (activation) { choose(active); return }
            const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1
            let next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : active + direction
            while (next >= 0 && next < choices.length && choices[next].disabled) next += direction
            if (next >= 0 && next < choices.length) setActive(next)
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault(); event.stopPropagation()
            const items = open ? choices : show()
            if (!items) return
            const now = Date.now(), text = now - typed.current.time < 700 ? typed.current.text + event.key : event.key
            typed.current = { text, time: now }
            const index = items.findIndex(choice => !choice.disabled && choice.label.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()))
            if (index >= 0) setActive(index)
          } else onKeyDown?.(event)
        }}>
        {hideNativeOptions(children, open)}
      </select>
      {open ? createPortal(<div id={id} ref={popup} role="listbox" data-select-listbox aria-label={props['aria-label']}
        className="fixed z-[200] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/15" style={position}
        onScroll={event => setScrollTop(event.currentTarget.scrollTop)} onMouseDown={event => event.preventDefault()}>
        <div style={{ height: choices.length * ROW_HEIGHT, position: 'relative' }}>
          {choices.slice(start, end).map((choice, offset) => { const index = start + offset; return <div key={index} id={`${id}-${index}`} role="option" aria-label={choice.label} aria-selected={trigger.current?.value === choice.value} aria-disabled={choice.disabled} aria-posinset={index + 1} aria-setsize={choices.length}
            title={[choice.group, choice.label].filter(Boolean).join(' · ')}
            className={cn('absolute left-0 right-0 flex items-center gap-2 rounded-lg px-3 text-sm', choice.disabled ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-700', index === active && !choice.disabled && 'bg-sky-50 text-sky-900')}
            style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }} onMouseMove={() => { if (!choice.disabled) setActive(index) }} onClick={() => choose(index)}>
            <span className="min-w-0 flex-1 truncate">{choice.label || '—'}</span>
            {choice.group ? <span className="max-w-32 truncate text-[11px] text-slate-400">{choice.group}</span> : null}
            {trigger.current?.value === choice.value ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-600" /> : null}
          </div> })}
        </div>
      </div>, trigger.current?.closest('[data-modal-dialog="true"]') ?? document.body) : null}
    </>
  },
)
Select.displayName = 'Select'

function hideNativeOptions(children: React.ReactNode, hidden: boolean): React.ReactNode {
  return React.Children.map(children, child => {
    if (!React.isValidElement<{ children?: React.ReactNode; 'aria-hidden'?: boolean }>(child)) return child
    return React.cloneElement(child, { ...(child.type === 'option' || child.type === 'optgroup' ? { 'aria-hidden': hidden || undefined } : {}), children: hideNativeOptions(child.props.children, hidden) })
  })
}
