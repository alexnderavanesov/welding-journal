import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type LargeDialogShellProps = {
  children: ReactNode
  maxWidthClassName?: string
  maxHeightClassName?: string
  overlayClassName?: string
  panelShadowClassName?: string
  panelRadiusClassName?: string
  panelClassName?: string
}

let bodyScrollLockCount = 0
let previousBodyOverflow = ''
let previousDocumentOverflow = ''

export function LargeDialogShell({
  children,
  maxWidthClassName = 'max-w-[1320px]',
  maxHeightClassName = 'max-h-[92vh]',
  overlayClassName = 'z-[70] bg-slate-950/30',
  panelShadowClassName = 'shadow-slate-950/20',
  panelRadiusClassName = 'rounded-md',
  panelClassName,
}: LargeDialogShellProps) {
  useEffect(() => {
    if (bodyScrollLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow
      previousDocumentOverflow = document.documentElement.style.overflow
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    }
    bodyScrollLockCount += 1

    return () => {
      bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1)
      if (bodyScrollLockCount === 0) {
        document.body.style.overflow = previousBodyOverflow
        document.documentElement.style.overflow = previousDocumentOverflow
      }
    }
  }, [])

  return (
    <div className={cn('fixed inset-0 flex items-center justify-center overflow-hidden overscroll-contain px-4 backdrop-blur-[1px]', overlayClassName)}>
      <div
        className={cn(
          'flex w-full flex-col overscroll-contain border border-slate-200 bg-white shadow-2xl',
          maxHeightClassName,
          maxWidthClassName,
          panelRadiusClassName,
          panelShadowClassName,
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
