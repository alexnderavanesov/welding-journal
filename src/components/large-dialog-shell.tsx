import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type LargeDialogShellProps = {
  children: ReactNode
  maxWidthClassName?: string
  maxHeightClassName?: string
  overlayClassName?: string
  panelShadowClassName?: string
  panelRadiusClassName?: string
}

export function LargeDialogShell({
  children,
  maxWidthClassName = 'max-w-[1320px]',
  maxHeightClassName = 'max-h-[92vh]',
  overlayClassName = 'z-[70] bg-slate-950/30',
  panelShadowClassName = 'shadow-slate-950/20',
  panelRadiusClassName = 'rounded-md',
}: LargeDialogShellProps) {
  return (
    <div className={cn('fixed inset-0 flex items-center justify-center px-4 backdrop-blur-[1px]', overlayClassName)}>
      <div
        className={cn(
          'flex w-full flex-col border border-slate-200 bg-white shadow-2xl',
          maxHeightClassName,
          maxWidthClassName,
          panelRadiusClassName,
          panelShadowClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
