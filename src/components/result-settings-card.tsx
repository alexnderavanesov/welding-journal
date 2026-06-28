import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type ResultSettingsCardProps = {
  title?: string
  muted?: boolean
  children: ReactNode
}

export function ResultSettingsCard({ title, muted = false, children }: ResultSettingsCardProps) {
  return (
    <div className={cn('rounded-md border border-slate-200 p-3', muted ? 'bg-slate-50 opacity-60' : 'bg-white')}>
      {title ? <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3> : null}
      {children}
    </div>
  )
}
