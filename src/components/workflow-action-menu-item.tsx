import type { ComponentType } from 'react'

export type WorkflowAvailability = 'loading' | 'error' | 'ready'

type WorkflowActionMenuItemProps = {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  disabledReason?: string
  description?: string
  availability?: WorkflowAvailability
  tone?: 'sky' | 'violet' | 'slate'
}

export function WorkflowActionMenuItem({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  disabledReason,
  description,
  availability = 'ready',
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

  const blocked = disabled || availability !== 'ready'
  const detail = availability === 'loading' ? 'Проверяем доступность…' : availability === 'error' ? 'Не удалось проверить доступность. Закройте меню и повторите.' : disabled ? disabledReason : description

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={blocked}
      aria-busy={availability === 'loading'}
      aria-label={label}
      className={`flex min-h-10 w-full items-start gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 transition-colors ${toneClasses} disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-400`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${blocked ? 'text-slate-300' : iconClass}`} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-5">{label}</span>
        {description || detail ? (
          <span title={detail} className={`mt-0.5 block text-xs font-normal leading-4 text-slate-500 ${description ? 'h-8 overflow-y-auto' : ''}`}>
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  )
}
