import type { ReactNode } from 'react'

import { DialogEmptyState } from '@/components/dialog-empty-state'

type ResultDialogRowsPanelProps = {
  title: string
  description: string
  actions?: ReactNode
  filters: ReactNode
  isEmpty: boolean
  emptyMessage: ReactNode
  children: ReactNode
}

export function ResultDialogRowsPanel({
  title,
  description,
  actions,
  filters,
  isEmpty,
  emptyMessage,
  children,
}: ResultDialogRowsPanelProps) {
  return (
    <section className="flex min-h-0 flex-col space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <p className="text-xs leading-5 text-slate-500">{description}</p>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>

      {filters}

      <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
        {isEmpty ? <DialogEmptyState>{emptyMessage}</DialogEmptyState> : children}
      </div>
    </section>
  )
}
