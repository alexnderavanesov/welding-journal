import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
export const SCHEME_SEARCH_CLOSE = 'scheme-search-close'

/** Expands in the existing header row, preserving list height and scroll. */
export function LineSchemePanelSearch({ label, placeholder, value, onChange, summary, children }: {
  label: string; placeholder: string; value: string; onChange: (value: string) => void; summary: ReactNode; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false), toggle = useRef<HTMLButtonElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const expanded = open || !!value
  const wasExpanded = useRef(expanded)
  useLayoutEffect(() => { if (wasExpanded.current && !expanded) toggle.current?.focus({ preventScroll: true }); wasExpanded.current = expanded }, [expanded])
  const close = () => { onChange(''); setOpen(false) }
  useLayoutEffect(() => {
    const element = container.current
    element?.addEventListener(SCHEME_SEARCH_CLOSE, close)
    return () => element?.removeEventListener(SCHEME_SEARCH_CLOSE, close)
  }, [onChange])
  return <div ref={container} data-scheme-panel-search={expanded ? 'open' : undefined} className="flex h-8 items-center gap-2">
    {expanded ? <div className="relative min-w-0 flex-1"><Input autoFocus aria-label={label} placeholder={placeholder} className="h-8 pr-7 text-xs" value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }} /><button type="button" className="absolute right-1 top-1 rounded p-1 text-slate-400" aria-label={`Закрыть ${label.toLocaleLowerCase('ru')}`} onClick={close}><X size={14} /></button></div>
      : <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{summary}</span>}
    <Button ref={toggle} type="button" variant="ghost" size="icon" className={`h-8 w-8 shrink-0 ${expanded ? 'hidden' : ''}`} aria-label={`Открыть ${label.toLocaleLowerCase('ru')}`} aria-expanded={expanded} onClick={() => setOpen(true)}><Search size={15} /></Button>
    {children}
  </div>
}
