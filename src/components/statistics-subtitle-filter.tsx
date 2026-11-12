import { overflowTitle } from '@/lib/overflow-title'
import { Checkbox } from '@/components/ui/checkbox'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Input } from './ui/input'
import { FilterResizeHandles } from './filter-resize-handles'

export function StatisticsSubtitleFilter({ options, value, onChange }: {
  options: { value: string; label: string }[]
  value: string[]
  onChange: (value: string[]) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [search, setSearch] = useState('')
  const [placement, setPlacement] = useState({ above: false, maxHeight: 340 })
  const selected = useMemo(() => new Set(value), [value])
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU')
    return options.filter(option => option.label.toLocaleLowerCase('ru-RU').includes(query))
  }, [options, search])
  const updatePlacement = useCallback(() => {
    const rect = root.current?.getBoundingClientRect()
    if (!rect) return
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) { setOpen(false); return }
    const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12
    const preferredHeight = Math.min(340, 94 + Math.max(1, options.length) * 36)
    const openAbove = below < Math.min(preferredHeight, above)
    const next = { above: openAbove, maxHeight: Math.min(340, Math.max(120, openAbove ? above : below)) }
    setPlacement(previous => previous.above === next.above && previous.maxHeight === next.maxHeight ? previous : next)
  }, [options.length])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    // WebKit may leave focus on body after a checkbox click, so Escape must
    // also work when the keyboard event does not pass through the popup root.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); setOpen(false)
      trigger.current?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', escape)
    let frame: number | null = null
    const reposition = (event: Event) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; updatePlacement() })
    }
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', reposition, true)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [open, updatePlacement])
  const summary = value.length === 0 ? 'Все шифры' : value.length === 1
    ? options.find(option => option.value === value[0])?.label ?? value[0]
    : `Выбрано шифров: ${value.length}`

  return <div ref={root} className="relative min-w-0" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
  }}>
    <span id={`${id}-label`} className="mb-1 block text-xs font-medium text-slate-600">Шифр/подтитул</span>
    <button ref={trigger} type="button" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-options`}
      className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm text-slate-700 shadow-sm hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
      onClick={() => {
        updatePlacement()
        setSearch(''); setOpen(!open)
      }}>
      <span id={`${id}-value`} className="truncate" {...overflowTitle(summary)}>{summary}</span><ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-slate-400 ${open ? 'rotate-180' : ''}`} />
    </button>
    {open ? <div ref={panel} id={`${id}-options`} role="dialog" aria-labelledby={`${id}-label`} style={{ maxHeight: placement.maxHeight }} className={`absolute left-0 right-0 z-40 flex flex-col rounded-lg border border-slate-200 bg-white shadow-lg ${placement.above ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
      <div className="shrink-0 border-b border-slate-100 p-2"><label className="relative block"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input autoFocus aria-label="Найти шифр" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Найти шифр…" className="h-9 pl-9" /></label></div>
      <div data-filter-scroll className="min-h-0 max-h-60 overflow-y-auto overscroll-contain p-1">
        {filtered.map(option => <label key={option.value} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-sky-50 focus-within:bg-sky-50">
          <Checkbox checked={selected.has(option.value)} onChange={event => onChange(event.target.checked ? [...value, option.value] : value.filter(item => item !== option.value))} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{option.label}</span>
        </label>)}
        {!filtered.length ? <p className="px-3 py-4 text-sm text-slate-400">Шифры не найдены</p> : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-3 py-2 text-xs">
        <span className="text-slate-500">{value.length ? `Выбрано: ${value.length}` : 'Без ограничения по шифру'}</span>
        <button type="button" disabled={!value.length} onClick={() => onChange([])} className="rounded text-sky-700 hover:text-sky-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:text-slate-300">Сбросить шифры</button>
      </div>
      <FilterResizeHandles panel={panel} />
    </div> : null}
  </div>
}
