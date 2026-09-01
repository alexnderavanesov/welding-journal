import { getLnkResultBadgeClass } from '@/lib/report-badges'

type WorkflowResultOptionPickerProps = {
  value: string
  options: readonly string[]
  compact?: boolean
  getDisabledReason?: (option: string) => string | undefined
  onChange: (option: string) => void
}

export function WorkflowResultOptionPicker({
  value,
  options,
  compact = false,
  getDisabledReason,
  onChange,
}: WorkflowResultOptionPickerProps) {
  return (
    <span className={compact ? 'flex min-w-0 flex-col gap-1' : 'mt-2 flex flex-wrap items-center gap-1.5'}>
      <span className="text-[11px] font-medium text-slate-500">Результат</span>
      <span className="flex items-center gap-1">
        {options.map((option) => {
          const active = value === option
          const disabledReason = getDisabledReason?.(option)
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (disabledReason) return
                onChange(option)
              }}
              disabled={Boolean(disabledReason)}
              title={disabledReason}
              className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                disabledReason
                  ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                  : active
                    ? getLnkResultBadgeClass(option)
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {option}
            </button>
          )
        })}
      </span>
    </span>
  )
}
