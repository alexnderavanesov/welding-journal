import type { ReactNode } from 'react'

type DialogInlineEmptyStateProps = {
  children: ReactNode
}

export function DialogInlineEmptyState({ children }: DialogInlineEmptyStateProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}
