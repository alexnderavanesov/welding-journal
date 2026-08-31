import { CircleAlert } from 'lucide-react'

export function BlockedActionHint({
  reason,
  actionLabel,
  onAction,
  tone = 'warning',
}: {
  reason: string
  actionLabel?: string
  onAction?: () => void
  tone?: 'warning' | 'danger'
}) {
  const danger = tone === 'danger'
  return (
    <div className={`inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium leading-relaxed ${
      danger
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-amber-200 bg-amber-50 text-amber-800'
    }`}>
      <CircleAlert className="h-4 w-4 shrink-0" />
      <span className="min-w-0">{reason}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={`font-semibold underline underline-offset-2 ${
            danger
              ? 'decoration-rose-300 hover:text-rose-950'
              : 'decoration-amber-300 hover:text-amber-950'
          }`}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
