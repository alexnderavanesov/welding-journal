import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type LargeDialogShellProps = {
  children: ReactNode
  maxWidthClassName?: string
  overlayClassName?: string
  panelShadowClassName?: string
}

export function LargeDialogShell({
  children,
  maxWidthClassName = 'max-w-[1320px]',
  overlayClassName = 'z-[70] bg-slate-950/30',
  panelShadowClassName = 'shadow-slate-950/20',
}: LargeDialogShellProps) {
  return (
    <div className={cn('fixed inset-0 flex items-center justify-center px-4 backdrop-blur-[1px]', overlayClassName)}>
      <div
        className={cn(
          'flex max-h-[92vh] w-full flex-col rounded-md border border-slate-200 bg-white shadow-2xl',
          maxWidthClassName,
          panelShadowClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
