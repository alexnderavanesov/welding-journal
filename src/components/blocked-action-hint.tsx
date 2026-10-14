import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type BlockedActionHintAction = {
  key: string
  label: string
  onAction: () => void
}

export function BlockedActionHint({
  reason,
  actionLabel,
  onAction,
  actions = [],
  tone = 'warning',
}: {
  reason: string
  actionLabel?: string
  onAction?: () => void
  actions?: BlockedActionHintAction[]
  tone?: 'warning' | 'danger'
}) {
  const danger = tone === 'danger'
  return (
    <div className={`flex max-w-full flex-nowrap items-start gap-2 rounded-md border px-3 py-2 text-xs font-medium leading-relaxed ${
      danger
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-amber-200 bg-amber-50 text-amber-800'
    }`}>
      <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="block whitespace-pre-line break-words">{reason}</span>
        {(actionLabel && onAction) || actions.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {actionLabel && onAction ? (
              <button
                type="button"
                onClick={onAction}
                className={`max-w-full text-left font-semibold underline underline-offset-2 ${
                  danger
                    ? 'decoration-rose-300 hover:text-rose-950'
                    : 'decoration-amber-300 hover:text-amber-950'
                }`}
              >
                {actionLabel}
              </button>
            ) : null}
            {actions.map((action) => (
              <Button
                key={action.key}
                type="button"
                variant="outline"
                size="sm"
                onClick={action.onAction}
                className={`h-8 max-w-full whitespace-normal px-2.5 text-xs ${
                  danger
                    ? 'border-rose-300 bg-white text-rose-800 hover:bg-rose-100'
                    : 'border-amber-300 bg-white text-amber-900 hover:bg-amber-100'
                }`}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
