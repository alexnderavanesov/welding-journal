import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type LargeDialogShellProps = {
  children: ReactNode
  maxWidthClassName?: string
}

export function LargeDialogShell({ children, maxWidthClassName = 'max-w-[1320px]' }: LargeDialogShellProps) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
      <div
        className={cn(
          'flex max-h-[92vh] w-full flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20',
          maxWidthClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
