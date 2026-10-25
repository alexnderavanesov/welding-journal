import { useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Input } from './input'

/** Free text stays editable; the bounded suggestions never restrict its value. */
export function AutocompleteInput({ value, options, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list'> & {
  value: string; options: string[]; onValueChange: (value: string) => void
}) {
  const input = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null)
  const id = useId(), [open, setOpen] = useState(false), [active, setActive] = useState(-1)
  const [scrollTop, setScrollTop] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 })
  const matches = options.filter(option => option.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()))
  const start = Math.max(0, Math.floor(scrollTop / 36) - 3)
  const shown = matches.slice(start, start + Math.ceil(position.maxHeight / 36) + 7)
  const visible = open && !props.disabled && !props.readOnly && matches.length > 0
  useLayoutEffect(() => {
    if (!visible || !input.current) return
    const place = () => {
      const rect = input.current!.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 180), innerWidth - 16)
      const below = innerHeight - rect.bottom - 12, above = rect.top - 12
      const up = below < 280 && above > below, maxHeight = Math.max(40, Math.min(280, up ? above : below))
      const height = Math.min(matches.length * 36 + 8, maxHeight)
      setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)), top: up ? rect.top - height - 4 : rect.bottom + 4, width, maxHeight })
    }
    place()
    const close = (event: Event) => { if (!(event.target instanceof Node && popup.current?.contains(event.target))) setOpen(false) }
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [visible, matches.length])
  useLayoutEffect(() => {
    const list = popup.current
    if (!list || active < 0) return
    const height = list.clientHeight || position.maxHeight
    if (active * 36 < list.scrollTop) list.scrollTop = active * 36
    else if ((active + 1) * 36 > list.scrollTop + height - 8) list.scrollTop = (active + 1) * 36 - height + 8
    setScrollTop(list.scrollTop)
  }, [active])
  const choose = (option: string) => { if (input.current?.matches(':disabled')) return; onValueChange(option); setOpen(false); setActive(-1) }
  return <>
    <Input {...props} ref={input} value={value} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={visible}
      aria-controls={visible ? id : undefined} aria-activedescendant={visible && active >= 0 ? `${id}-${active}` : undefined}
      onFocus={event => { setOpen(true); setScrollTop(0); props.onFocus?.(event) }} onBlur={event => { setOpen(false); props.onBlur?.(event) }}
      onChange={event => { onValueChange(event.target.value); setOpen(true); setActive(-1); setScrollTop(0); if (popup.current) popup.current.scrollTop = 0 }}
      onKeyDown={event => {
        if (event.key === 'Escape' && visible) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); return }
        if (event.key === 'Enter' && visible && matches[active]) { event.preventDefault(); event.stopPropagation(); choose(matches[active]); return }
        props.onKeyDown?.(event)
      }} />
    {visible ? createPortal(<div id={id} ref={popup} role="listbox" data-select-listbox aria-label="Подсказки клейма НАКС" style={position}
      className="fixed z-[200] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/15" onScroll={event => setScrollTop(event.currentTarget.scrollTop)} onMouseDown={event => event.preventDefault()}>
      <div style={{ height: matches.length * 36, position: 'relative' }}>
        {shown.map((option, offset) => { const index = start + offset; return <div key={option} id={`${id}-${index}`} role="option" aria-selected={index === active} aria-posinset={index + 1} aria-setsize={matches.length}
          className={`absolute left-0 right-0 flex h-9 cursor-pointer items-center rounded-lg px-3 text-sm ${index === active ? 'bg-sky-50 text-sky-900' : 'text-slate-700 hover:bg-slate-50'}`} style={{ top: index * 36 }}
          onMouseMove={() => setActive(index)} onClick={() => choose(option)}>{option}</div> })}
      </div>
    </div>, input.current?.closest('[data-modal-dialog="true"]') ?? document.body) : null}
  </>
}
