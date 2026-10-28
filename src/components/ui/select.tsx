import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

type Choice = { value: string; label: string; disabled: boolean; group: string; reason: string }
type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { searchable?: boolean }
const ROW_HEIGHT = 36

function readChoices(select: HTMLSelectElement): Choice[] {
  return Array.from(select.options, option => ({ value: option.value, label: option.label,
    disabled: option.disabled || option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled,
    group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : '', reason: option.title }))
}

// The select retains form values, labels, validation and existing change handlers.
// Its native popup is replaced by a styled, bounded listbox.
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, searchable = false, onChange, onKeyDown, onMouseDown, onPointerDown, onClick, onBlur, ...props }, forwardedRef) => {
    const trigger = React.useRef<HTMLSelectElement>(null)
    const popup = React.useRef<HTMLDivElement>(null)
    const list = React.useRef<HTMLDivElement>(null)
    const search = React.useRef<HTMLInputElement>(null)
    const id = React.useId()
    const [open, setOpen] = React.useState(false)
    const [choices, setChoices] = React.useState<Choice[]>([])
    const [query, setQuery] = React.useState('')
    const [active, setActive] = React.useState(-1)
    const [scrollTop, setScrollTop] = React.useState(0)
    const [position, setPosition] = React.useState({ left: 0, top: 0, width: 0, maxHeight: 320 })
    const typed = React.useRef({ text: '', time: 0 })
    const matching = React.useMemo(() => choices.flatMap((choice, index) =>
      !searchable || choice.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ? [index] : []), [choices, query, searchable])
    const headerHeight = searchable ? 48 : 0
    const listHeight = Math.max(ROW_HEIGHT, position.maxHeight - headerHeight)
    const show = () => {
      const select = trigger.current
      if (!select || select.matches(':disabled')) return
      const items = readChoices(select)
      if (!items.length) return
      setChoices(items); setActive(select.selectedIndex); setScrollTop(0); setQuery('')
      typed.current = { text: '', time: 0 }
      select.focus({ preventScroll: true }); setOpen(true)
      return items
    }
    const choose = (index: number) => {
      const select = trigger.current, choice = choices[index]
      if (!select || select.matches(':disabled') || !choice || choice.disabled || !matching.includes(index)) return
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
      const contentHeight = Math.max(1, matching.length) * ROW_HEIGHT + 8 + headerHeight
      const up = below < Math.min(320, contentHeight) && above > below
      const maxHeight = Math.max(40 + headerHeight, Math.min(320, up ? above : below))
      const height = Math.min(contentHeight, maxHeight)
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: up ? rect.top - height - 4 : rect.bottom + 4, width, maxHeight })
    }, [open, matching.length, headerHeight])
    React.useLayoutEffect(() => { if (open && searchable) search.current?.focus({ preventScroll: true }) }, [open, searchable])
    React.useLayoutEffect(() => {
      const element = list.current, index = matching.indexOf(active)
      if (!open || !element || index < 0) return
      const height = element.clientHeight || listHeight
      if (index * ROW_HEIGHT < element.scrollTop) element.scrollTop = index * ROW_HEIGHT
      else if ((index + 1) * ROW_HEIGHT > element.scrollTop + height - 8) element.scrollTop = (index + 1) * ROW_HEIGHT - height + 8
      setScrollTop(element.scrollTop)
    }, [open, active, listHeight, matching])
    React.useEffect(() => { setOpen(false) }, [props.disabled, props.value])
    React.useLayoutEffect(() => {
      if (!open || !trigger.current) return
      const items = readChoices(trigger.current)
      if (trigger.current.matches(':disabled') || items.length !== choices.length || items.some((item, index) => {
        const previous = choices[index]
        return item.value !== previous.value || item.label !== previous.label || item.disabled !== previous.disabled || item.group !== previous.group || item.reason !== previous.reason
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
    const filter = (text: string, items = choices) => {
      setQuery(text); setScrollTop(0)
      if (list.current) list.current.scrollTop = 0
      setActive(items.findIndex(choice => !choice.disabled && choice.label.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase())))
    }
    const navigate = (key: string) => {
      const direction = key === 'ArrowUp' || key === 'End' ? -1 : 1
      let next = key === 'Home' ? 0 : key === 'End' ? matching.length - 1 : matching.indexOf(active) + direction
      while (next >= 0 && next < matching.length && choices[matching[next]].disabled) next += direction
      if (next >= 0 && next < matching.length) setActive(matching[next])
    }
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3)
    const end = Math.min(matching.length, start + Math.ceil(listHeight / ROW_HEIGHT) + 7)
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
            navigate(event.key)
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault(); event.stopPropagation()
            const items = open ? choices : show()
            if (!items) return
            if (searchable) { filter((open ? query : '') + event.key, items); return }
            const now = Date.now(), text = now - typed.current.time < 700 ? typed.current.text + event.key : event.key
            typed.current = { text, time: now }
            const index = items.findIndex(choice => !choice.disabled && choice.label.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()))
            if (index >= 0) setActive(index)
          } else onKeyDown?.(event)
        }}>
        {hideNativeOptions(children, open)}
      </select>
      {open ? createPortal(<div ref={popup} data-select-listbox
        className="fixed z-[200] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/15" style={position}
        onMouseDown={event => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault() }}>
        {searchable ? <div className="flex h-12 items-center gap-2 border-b border-slate-100 px-3">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
          <input ref={search} value={query} role="combobox" aria-label={`Поиск: ${props['aria-label'] ?? 'варианты'}`}
            aria-autocomplete="list" aria-expanded="true" aria-controls={id} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
            autoComplete="off" placeholder="Поиск…" className="h-9 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0"
            onChange={event => filter(event.target.value)}
            onBlur={event => { if (!popup.current?.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false) }}
            onKeyDown={event => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }) }
              else if (event.key === 'Tab') { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
              else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); navigate(event.key) }
              else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) choose(active) }
            }} />
        </div> : null}
        <div id={id} ref={list} role="listbox" aria-label={props['aria-label']} className="overflow-y-auto overscroll-contain p-1" style={{ maxHeight: listHeight }}
          onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
        {matching.length === 0 ? <div className="px-3 py-2 text-sm text-slate-500">Ничего не найдено</div> : null}
        <div style={{ height: matching.length * ROW_HEIGHT, position: 'relative' }}>
          {matching.slice(start, end).map((index, offset) => { const choice = choices[index]; return <div key={index} id={`${id}-${index}`} role="option" aria-label={choice.label} aria-selected={trigger.current?.value === choice.value} aria-disabled={choice.disabled} aria-posinset={start + offset + 1} aria-setsize={matching.length}
            title={[choice.group, choice.label, choice.reason].filter(Boolean).join(' · ')}
            className={cn('absolute left-0 right-0 flex items-center gap-2 rounded-lg px-3 text-sm', choice.disabled ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-700', index === active && !choice.disabled && 'bg-sky-50 text-sky-900')}
            style={{ top: (start + offset) * ROW_HEIGHT, height: ROW_HEIGHT }} onMouseMove={() => { if (!choice.disabled) setActive(index) }} onClick={() => choose(index)}>
            <span className="min-w-0 flex-1 truncate">{choice.label || '—'}</span>
            {choice.group ? <span className="max-w-32 truncate text-[11px] text-slate-400">{choice.group}</span> : null}
            {trigger.current?.value === choice.value ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-600" /> : null}
          </div> })}
        </div>
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
