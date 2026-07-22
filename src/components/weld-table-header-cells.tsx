import { Check, FilterX, Minus } from 'lucide-react'
import type { CSSProperties } from 'react'

type StickyCoverStyle = CSSProperties & {
  '--weld-sticky-cover-left'?: string
}

type WeldTableSelectAllHeaderProps = {
  selectable: boolean
  checked: boolean
  indeterminate: boolean
  disabled: boolean
  title: string
  selectedRowsCount: number
  hasColumnFilters: boolean
  sticky: boolean
  stickyLeft: number
  onChange?: (selected: boolean) => void
  onResetColumnFilters: () => void
}

export function WeldTableSelectAllHeader({
  selectable,
  checked,
  indeterminate,
  disabled,
  title,
  selectedRowsCount,
  hasColumnFilters,
  sticky,
  stickyLeft,
  onChange,
  onResetColumnFilters,
}: WeldTableSelectAllHeaderProps) {
  return (
    <th
      rowSpan={2}
      className={`relative border-b-2 border-r border-t-2 border-b-[#d3e3ee] border-r-[#e7f0f6] border-t-[#d3e3ee] bg-[#f6fbfe] px-2 py-2.5 text-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.86)] ${
        sticky ? getStickyCoverClassName('z-40') : ''
      }`}
      style={sticky ? getStickyCoverStyle(stickyLeft) : undefined}
    >
      {selectedRowsCount > 0 ? (
        <span
          className="absolute left-1/2 top-2 inline-flex h-5 min-w-5 -translate-x-1/2 items-center justify-center rounded-full border border-sky-200 bg-sky-100 px-1.5 text-[11px] font-semibold leading-none text-sky-800 shadow-sm"
          title={`Выбрано строк: ${selectedRowsCount}. Правый клик по выбранной строке откроет групповое меню.`}
        >
          {selectedRowsCount > 999 ? '999+' : selectedRowsCount}
        </span>
      ) : null}
      <div className="flex min-h-24 flex-col items-center justify-end gap-1.5">
        {selectable ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange?.(!(checked || indeterminate))}
            aria-label="Выбрать видимые стыки"
            aria-pressed={checked}
            title={title}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              checked || indeterminate
                ? 'border-sky-300 bg-sky-100 text-sky-800'
                : 'border-slate-300 bg-white text-transparent hover:border-sky-300 hover:bg-sky-50 hover:text-sky-500'
            }`}
          >
            {indeterminate ? <Minus className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onResetColumnFilters}
          disabled={!hasColumnFilters}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-100 hover:text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 disabled:shadow-none"
          title={hasColumnFilters ? 'Сбросить все фильтры' : 'Фильтры не заданы'}
          aria-label="Сбросить все фильтры"
        >
          <FilterX className="h-3.5 w-3.5" />
        </button>
      </div>
    </th>
  )
}

function getStickyCoverClassName(zIndexClassName: string) {
  return `sticky ${zIndexClassName} before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-[var(--weld-sticky-cover-left)] before:bg-inherit before:content-['']`
}

function getStickyCoverStyle(left: number): StickyCoverStyle {
  return {
    left,
    '--weld-sticky-cover-left': `${Math.max(left, 0)}px`,
  }
}

type WeldTableRowActionsHeaderProps = {
  label: string
  screenReaderLabel: string
}

export function WeldTableRowActionsHeader({ label, screenReaderLabel }: WeldTableRowActionsHeaderProps) {
  return (
    <th
      rowSpan={2}
      className="border-b-2 border-r-2 border-t-2 border-b-[#d3e3ee] border-r-[#d3e3ee] border-t-[#d3e3ee] bg-[#f6fbfe] px-2 py-2.5 text-center text-xs font-semibold text-slate-600 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.86)]"
      title={label}
    >
      <span className="sr-only">{screenReaderLabel}</span>
    </th>
  )
}
