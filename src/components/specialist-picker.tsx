import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Eraser, Minus, UserRound } from 'lucide-react'
import type { SpecialistRecord } from '@/lib/document-specialists'

type Choice = { value: number | null | undefined; name: string; detail?: string }

/** Shared, bounded list; options are supplied by the parent's single registry query. */
export function SpecialistPicker({ label, value, onChange, records, selected, allowKeep, disabled, currentLabel, compact, search }: {
  label: string; value: number | null | undefined; onChange: (value: number | null | undefined) => void
  records: SpecialistRecord[]; selected?: SpecialistRecord; allowKeep: boolean; disabled: boolean; currentLabel?: string; compact: boolean
  search?: ReactNode
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', time: 0 })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 320 })
  const effectiveValue = value === undefined && !allowKeep ? null : value
  const choices: Choice[] = [
    ...(allowKeep ? [{ value: undefined, name: 'Не изменять', detail: 'Сохранить текущее назначение' }] : []),
    { value: null, name: allowKeep ? 'Очистить назначение' : 'Не назначен', detail: allowKeep ? 'Убрать ФИО и удостоверение' : undefined },
    ...records.map(record => ({ value: record.id, name: record.name, detail: `№ ${record.certificate}` })),
  ]
  const selectedChoice = choices.find(choice => choice.value === effectiveValue) ?? (value ? { name: selected?.name || currentLabel || `Специалист №${value}`, detail: selected?.certificate ? `№ ${selected.certificate}` : undefined } : undefined)
  const show = () => {
    if (disabled || trigger.current?.matches(':disabled')) return
    typed.current = { text: '', time: 0 }
    setActive(Math.max(0, choices.findIndex(choice => choice.value === effectiveValue)))
    setOpen(true)
  }
  const choose = (choice: Choice) => { onChange(choice.value); setOpen(false); trigger.current?.focus({ preventScroll: true }) }

  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16)
    const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12
    const up = below < Math.min(320, choices.length * 52 + 8) && above > below
    const maxHeight = Math.max(48, Math.min(320, up ? above : below))
    if (popup.current) popup.current.style.width = `${width}px`
    const height = Math.min(popup.current?.scrollHeight ?? maxHeight, maxHeight)
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: up ? rect.top - height - 4 : rect.bottom + 4, width, maxHeight })
  }, [open, choices.length])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useEffect(() => { setActive(index => Math.min(index, choices.length - 1)) }, [choices.length])
  useEffect(() => {
    if (!open) return
    const list = popup.current
    const option = list?.querySelector<HTMLElement>(`[data-choice-index="${active}"]`)
    if (!list || !option) return
    // Scroll only the options. scrollIntoView also scrolls clipped modal ancestors
    // while the portal is being positioned, moving the trigger and closing it.
    const inset = list.querySelector<HTMLElement>('[data-specialist-search]')?.offsetHeight ?? 0
    if (option.offsetTop < list.scrollTop + inset) list.scrollTop = option.offsetTop - inset
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight
    }
  }, [active, open])
  useEffect(() => {
    if (!open) return
    const anchor = trigger.current?.getBoundingClientRect()
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false)
    }
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return
      const current = trigger.current?.getBoundingClientRect()
      // Focus and scrollIntoView can enqueue a scroll event before the picker opens.
      // A stationary anchor means the popup is still correctly positioned.
      if (anchor && current && Math.abs(anchor.left - current.left) < 0.5 && Math.abs(anchor.top - current.top) < 0.5) return
      setOpen(false)
    }
    const resize = () => setOpen(false)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize) }
  }, [open])

  return <>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} disabled={disabled}
      title={[selectedChoice?.name, selectedChoice?.detail].filter(Boolean).join(' · ')}
      className={`flex w-full min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm shadow-sm shadow-slate-100/50 transition-colors hover:border-sky-200 hover:bg-sky-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 ${compact ? 'h-8' : 'h-10'} ${value ? 'text-slate-700' : 'text-slate-500'}`}
      onClick={() => open ? setOpen(false) : show()}
      onBlur={event => { if (!popup.current?.contains(event.relatedTarget as Node)) setOpen(false) }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
        if (event.key === 'Tab') { setOpen(false); return }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          if (!open) { show(); return }
          setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (open && choices[active]) choose(choices[active]); else show()
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault()
          const now = Date.now(), text = (now - typed.current.time > 700 ? '' : typed.current.text) + event.key.toLocaleLowerCase('ru')
          if (!open) show()
          typed.current = { text, time: now }
          const match = choices.findIndex(choice => `${choice.name} ${choice.detail ?? ''}`.toLocaleLowerCase('ru').includes(text))
          if (match >= 0) setActive(match)
        }
      }}>
      <span className="min-w-0 flex-1 truncate">{selectedChoice?.name}</span><ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open ? createPortal(<div ref={popup} data-specialist-listbox
      onBlur={event => { if (!popup.current?.contains(event.relatedTarget as Node) && !trigger.current?.contains(event.relatedTarget as Node)) setOpen(false) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }) }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); trigger.current?.focus({ preventScroll: true }); setActive(event.key === 'ArrowDown' ? 0 : choices.length - 1) }
      }}
      className="fixed z-[180] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/15" style={position}>
      {search ? <div data-specialist-search className="sticky top-0 z-10 border-b border-slate-100 bg-white p-2">{search}</div> : null}
      <div id={id} role="listbox" aria-label={label}>
      {choices.map((choice, index) => {
        const Icon = choice.value === undefined ? Minus : choice.value === null ? Eraser : UserRound
        return <div key={String(choice.value)} id={`${id}-${index}`} role="option" aria-selected={choice.value === effectiveValue} aria-label={choice.name}
          data-choice-index={index} data-specialist-id={choice.value ?? ''}
          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${index === active ? 'bg-sky-50 text-sky-900' : 'text-slate-700 hover:bg-slate-50'} ${choice.value === null && allowKeep ? 'text-rose-700' : ''}`}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(choice)}>
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0 opacity-60" /><span className="min-w-0 flex-1"><span className="block break-words font-medium">{choice.name}</span>{choice.detail ? <span className="mt-0.5 block break-words text-xs font-normal text-slate-500">{choice.detail}</span> : null}</span>
          {choice.value === effectiveValue ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-600" /> : null}
        </div>
      })}
      </div>
      {!records.length ? <p className="px-3 py-2 text-xs text-slate-500">Нет подходящих специалистов. Попробуйте другое ФИО или удостоверение.</p> : null}
    </div>, trigger.current?.closest('[data-modal-dialog="true"]') ?? document.body) : null}
  </>
}
