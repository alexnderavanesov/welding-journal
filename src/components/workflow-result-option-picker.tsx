import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { getLnkResultBadgeClass } from '@/lib/report-badges'

type WorkflowResultOptionPickerProps = {
  value: string
  options: readonly string[]
  compact?: boolean
  label?: string
  restrictionHelpHref?: string
  restrictionHelpLabel?: string
  reserveHelpSpace?: boolean
  helperText?: string
  getDisabledReason?: (option: string) => string | undefined
  onChange: (option: string) => void
}

export function WorkflowResultOptionPicker({
  value,
  options,
  compact = false,
  label = 'Результат',
  restrictionHelpHref,
  restrictionHelpLabel = 'Подробнее о правиле СП-07',
  reserveHelpSpace = false,
  helperText,
  getDisabledReason,
  onChange,
}: WorkflowResultOptionPickerProps) {
  const choices = options.map((option) => ({ option, disabledReason: getDisabledReason?.(option) }))
  const showHelp = Boolean(restrictionHelpHref && choices.some(({ disabledReason }) => disabledReason))
  return (
    <span className={compact ? 'flex min-w-0 flex-col gap-1' : 'mt-2 flex flex-wrap items-center gap-1.5'}>
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <span role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
        {choices.map(({ option, disabledReason }) => {
          const active = value === option
          return (
            <WorkflowResultOption
              key={option}
              option={option}
              active={active}
              disabledReason={disabledReason}
              onChange={onChange}
            />
          )
        })}
      </span>
      {reserveHelpSpace || showHelp || helperText ? <span data-result-picker-help className="flex min-h-4 items-center justify-between gap-2 text-[11px] leading-4">
        {helperText ? <span className="text-slate-500">{helperText}</span> : null}
        {showHelp ? <a href={restrictionHelpHref} target="_blank" rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="whitespace-nowrap text-sky-700 underline underline-offset-2 hover:text-sky-900">
          {restrictionHelpLabel}
        </a> : null}
      </span> : null}
    </span>
  )
}

function WorkflowResultOption({ option, active, disabledReason, onChange }: {
  option: string
  active: boolean
  disabledReason?: string
  onChange: (option: string) => void
}) {
  const tooltipId = useId()
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const isTooltipOpen = Boolean(position)
  useEffect(() => {
    if (!isTooltipOpen) return
    const closeTooltip = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setPosition(null)
    }
    window.addEventListener('keydown', closeTooltip, true)
    return () => window.removeEventListener('keydown', closeTooltip, true)
  }, [isTooltipOpen])
  const showReason = (element: HTMLElement) => {
    if (!disabledReason) return
    const rect = element.getBoundingClientRect()
    const above = rect.top > window.innerHeight / 2
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
      top: above ? rect.top - 8 : rect.bottom + 8,
      above,
    })
  }
  return (
    <span
      className="inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      tabIndex={disabledReason ? 0 : undefined}
      role={disabledReason ? 'group' : undefined}
      aria-label={disabledReason ? option : undefined}
      aria-describedby={disabledReason && position ? tooltipId : undefined}
      onMouseEnter={(event) => showReason(event.currentTarget)}
      onMouseLeave={() => setPosition(null)}
      onFocus={(event) => showReason(event.currentTarget)}
      onBlur={() => setPosition(null)}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <button
        type="button"
        aria-pressed={active}
        aria-describedby={disabledReason && position ? tooltipId : undefined}
        disabled={Boolean(disabledReason)}
        title={disabledReason}
        onClick={() => {
          if (!disabledReason) onChange(option)
        }}
        className={`rounded border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          active ? getLnkResultBadgeClass(option)
            : disabledReason ? 'border-slate-200 bg-slate-50 text-slate-400'
              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
        }`}
      >
        {option}
      </button>
      {disabledReason && position ? createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          data-workflow-result-tooltip="true"
          className="pointer-events-none fixed z-[300] w-80 max-w-[calc(100vw-16px)] whitespace-pre-line rounded-md bg-slate-900 px-3 py-2 text-xs font-normal leading-5 text-white shadow-lg"
          style={{ left: position.left, top: position.top, transform: position.above ? 'translateY(-100%)' : undefined }}
        >
          {disabledReason}
        </span>,
        document.body,
      ) : null}
    </span>
  )
}
