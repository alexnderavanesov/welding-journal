import { Check, Columns3 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
  DocumentHistoryColumnDefinition,
  DocumentHistoryColumnKey,
} from '@/lib/document-history-columns'

export function DocumentHistoryColumnChooser({
  columns,
  visibleColumnKeys,
  onChange,
}: {
  columns: readonly DocumentHistoryColumnDefinition[]
  visibleColumnKeys: readonly DocumentHistoryColumnKey[]
  onChange: (keys: DocumentHistoryColumnKey[]) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const visibleSet = new Set(visibleColumnKeys)

  useEffect(() => {
    if (!isOpen) return undefined
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !rootRef.current?.contains(target)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const toggleColumn = (column: DocumentHistoryColumnDefinition) => {
    if (column.required) return
    const nextVisible = new Set(visibleColumnKeys)
    if (nextVisible.has(column.key)) nextVisible.delete(column.key)
    else nextVisible.add(column.key)
    onChange(columns.filter((candidate) => candidate.required || nextVisible.has(candidate.key)).map((candidate) => candidate.key))
  }

  return (
    <div ref={rootRef} className="relative ml-auto shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold shadow-sm transition-colors ${
          isOpen
            ? 'border-sky-300 bg-sky-50 text-sky-900'
            : 'border-[#cbdde6] bg-white text-[#31566a] hover:border-[#79aebe] hover:bg-[#edf7fa]'
        }`}
      >
        <Columns3 className="h-4 w-4" aria-hidden="true" />
        Столбцы
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-600">
          {visibleColumnKeys.length}/{columns.length}
        </span>
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Столбцы истории документов"
          className="absolute right-0 top-12 z-[70] w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-300/40"
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2.5">
            <span className="text-sm font-semibold text-slate-800">Столбцы таблицы</span>
            <button
              type="button"
              className="text-xs font-medium text-sky-700 hover:text-sky-900"
              onClick={() => onChange(columns.map((column) => column.key))}
            >
              Показать все
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {columns.map((column) => {
              const checked = column.required || visibleSet.has(column.key)
              return (
                <button
                  key={column.key}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={column.required}
                  onClick={() => toggleColumn(column)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:bg-slate-50/60"
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white'
                  }`}>
                    {checked ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">{column.label}</span>
                  {column.required ? <span className="text-[11px] text-slate-400">обязательный</span> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
