import { createContext, useCallback, useContext, useEffect, useRef, type ComponentType, type ReactNode, type RefObject } from 'react'

const PendingActionContext = createContext<RefObject<symbol | null> | null>(null)

/** Only the most recently selected action in an open menu may await its check. */
export function WorkflowActionScope({ children }: { children: ReactNode }) {
  const pending = useRef<symbol | null>(null)
  return <PendingActionContext.Provider value={pending}>{children}</PendingActionContext.Provider>
}

/** Cancel synchronously before another entry point can update availability. */
export function useCancelPendingWorkflowAction() {
  const pending = useContext(PendingActionContext)
  return useCallback(() => { if (pending) pending.current = null }, [pending])
}

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
  const localPending = useRef<symbol | null>(null)
  const pending = useContext(PendingActionContext) ?? localPending
  const token = useRef(Symbol('workflow-action'))
  const activated = useRef(false)
  useEffect(() => {
    if (availability === 'loading') { activated.current = false; return }
    if (pending.current !== token.current) return
    pending.current = null
    if (availability === 'ready' && !disabled) {
      activated.current = true
      onClick()
    }
  }, [availability, disabled, onClick, pending])
  useEffect(() => {
    const currentToken = token.current
    return () => { if (pending.current === currentToken) pending.current = null }
  }, [pending])
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

  const blocked = disabled || availability === 'error'
  const detail = disabled ? disabledReason : availability === 'error' ? 'Не удалось проверить доступность. Закройте меню и повторите.' : description

  return (
    <button
      type="button"
      onClick={() => {
        if (blocked || activated.current) return
        if (availability === 'loading') { pending.current = token.current; return }
        pending.current = null
        activated.current = true
        onClick()
      }}
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
