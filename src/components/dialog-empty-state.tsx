import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type DialogEmptyStateProps = {
  children: ReactNode
  minHeightClassName?: string
}

export function DialogEmptyState({ children, minHeightClassName = 'min-h-72' }: DialogEmptyStateProps) {
  return (
    <div className={cn('flex items-center justify-center px-4 py-10 text-center text-sm text-slate-500', minHeightClassName)}>
      {children}
    </div>
  )
}
