import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'

type StickyCoverStyle = CSSProperties & {
  '--weld-sticky-cover-left'?: string
}

type WeldTableRowSelectCellProps = {
  selectable: boolean
  label: string
  checked: boolean
  disabled: boolean
  sticky?: boolean
  stickyLeft?: number
  stickyBackgroundClassName?: string
  onChange: (selected: boolean) => void
}

export function WeldTableRowSelectCell({
  selectable,
  label,
  checked,
  disabled,
  sticky = false,
  stickyLeft = 0,
  stickyBackgroundClassName = 'bg-white',
  onChange,
}: WeldTableRowSelectCellProps) {
  return (
    <td
      className={`border-b border-r border-b-slate-100 border-r-slate-200 px-2 py-2.5 text-center align-top ${
        disabled ? 'bg-slate-200/80 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.14)]' : sticky ? stickyBackgroundClassName : 'bg-inherit'
      } ${sticky ? getStickyCoverClassName('z-[1]') : ''}`}
      style={sticky ? getStickyCoverStyle(stickyLeft) : undefined}
    >
      {selectable ? (
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            onChange(!checked)
          }}
          aria-label={`Выбрать стык ${label}`}
          aria-pressed={checked}
          title={disabled ? 'Строка недоступна для выбора' : 'Выбрать строку'}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md border shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
            checked
              ? 'border-sky-300 bg-sky-100 text-sky-800'
              : 'border-slate-300 bg-white text-transparent hover:border-sky-300 hover:bg-sky-50 hover:text-sky-500'
          }`}
        >
          <Check className="h-4 w-4" />
        </button>
      ) : null}
    </td>
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
