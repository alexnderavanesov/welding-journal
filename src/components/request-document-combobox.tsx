import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizeSearchText } from '@/lib/report-row-utils'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'

type RequestDocumentComboboxProps = {
  ariaLabel: string
  value: string
  options: RequestDocumentIdentity[]
  placeholder?: string
  emptyOptionLabel?: string
  disabled?: boolean
  className?: string
  onChange: (request: RequestDocumentIdentity | null) => void
}

export function RequestDocumentCombobox({
  ariaLabel,
  value,
  options,
  placeholder = 'Найдите и выберите заявку',
  emptyOptionLabel,
  disabled = false,
  className = '',
  onChange,
}: RequestDocumentComboboxProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.key === value) ?? null
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) return options
    return options.filter((option) => normalizeSearchText([
      option.label,
      option.name,
      option.date,
    ].join(' ')).includes(normalizedQuery))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const choose = (request: RequestDocumentIdentity | null) => {
    onChange(request)
    setOpen(false)
    setQuery('')
  }
  const openPicker = () => {
    if (disabled) return
    setOpen(true)
    setQuery('')
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          ref={inputRef}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled}
          value={open ? query : selected?.label ?? ''}
          placeholder={placeholder}
          className="h-9 truncate bg-white pl-9 pr-16"
          onFocus={() => {
            if (!open) openPicker()
          }}
          onChange={(event) => {
            if (!open) setOpen(true)
            setQuery(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (!open) return openPicker()
              setActiveIndex((index) => Math.min(index + 1, filteredOptions.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((index) => Math.max(0, index - 1))
            } else if (event.key === 'Enter' && open) {
              event.preventDefault()
              const option = filteredOptions[activeIndex]
              if (option) choose(option)
              else if (emptyOptionLabel && !query) choose(null)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
              setQuery('')
            }
          }}
        />
        {selected && !open ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Сбросить выбранную заявку"
            disabled={disabled}
            className="absolute right-8 top-1/2 h-7 w-7 -translate-y-1/2 p-0 text-slate-400 hover:text-slate-700"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Открыть список заявок"
          disabled={disabled}
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0 text-slate-400 hover:text-slate-700"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => open ? setOpen(false) : openPicker()}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-[70] mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10"
        >
          {emptyOptionLabel && !query ? (
            <button
              type="button"
              role="option"
              aria-selected={!selected}
              className="flex min-h-9 w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(null)}
            >
              <span>{emptyOptionLabel}</span>
              {!selected ? <Check className="h-4 w-4 text-sky-600" /> : null}
            </button>
          ) : null}
          {filteredOptions.map((option, index) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={option.key === selected?.key}
              className={`flex min-h-10 w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm ${
                index === activeIndex ? 'bg-sky-50 text-sky-950' : 'text-slate-700 hover:bg-slate-50'
              }`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <span className="min-w-0">
                <strong className="block truncate font-medium">{option.name}</strong>
                <span className="mt-0.5 block text-xs text-slate-500">{option.date || 'Дата не указана'}</span>
              </span>
              {option.key === selected?.key ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
            </button>
          ))}
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-5 text-center text-sm text-slate-500">Заявки не найдены.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
