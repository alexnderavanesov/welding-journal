import type { ComponentType } from 'react'

type WorkflowActionMenuItemProps = {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  disabledReason?: string
  tone?: 'sky' | 'violet' | 'slate'
}

export function WorkflowActionMenuItem({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  disabledReason,
  tone = 'sky',
}: WorkflowActionMenuItemProps) {
  const toneClasses = tone === 'violet'
    ? 'hover:bg-violet-50 hover:text-violet-900'
    : tone === 'slate'
      ? 'hover:bg-slate-50 hover:text-slate-900'
      : 'hover:bg-sky-50 hover:text-sky-900'
  const iconClass = tone === 'violet'
    ? 'text-violet-600'
    : tone === 'slate'
      ? 'text-slate-500'
      : 'text-sky-600'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex min-h-10 w-full items-start gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 transition-colors ${toneClasses} disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-400`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${disabled ? 'text-slate-300' : iconClass}`} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-5">{label}</span>
        {disabled && disabledReason ? (
          <span className="mt-0.5 block text-xs font-normal leading-4 text-slate-400">
            {disabledReason}
          </span>
        ) : null}
      </span>
    </button>
  )
}
