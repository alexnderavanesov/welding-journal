import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

import type { PageScrollPosition } from '@/lib/page-scroll-position'
import { getPageScrollPosition } from '@/lib/page-scroll-position'
import { cn } from '@/lib/utils'

type LargeDialogShellProps = {
  children: ReactNode
  ariaLabel?: string
  maxWidthClassName?: string
  maxHeightClassName?: string
  overlayClassName?: string
  panelShadowClassName?: string
  panelRadiusClassName?: string
  panelClassName?: string
  returnPageScrollPosition?: PageScrollPosition
}

let pageScrollLockCount = 0
let previousDocumentOverflow: Array<{ name: string; value: string; priority: string }> = []
let lockedPageScrollPosition = { left: 0, top: 0 }
let restorePageScrollFrame: number | null = null
let restorePageScrollInnerFrame: number | null = null

function cancelPendingPageScrollRestore() {
  if (restorePageScrollFrame !== null) {
    window.cancelAnimationFrame(restorePageScrollFrame)
    restorePageScrollFrame = null
  }
  if (restorePageScrollInnerFrame !== null) {
    window.cancelAnimationFrame(restorePageScrollInnerFrame)
    restorePageScrollInnerFrame = null
  }
}

function schedulePageScrollRestore() {
  cancelPendingPageScrollRestore()
  restorePageScrollFrame = window.requestAnimationFrame(() => {
    restorePageScrollFrame = null
    restorePageScrollInnerFrame = window.requestAnimationFrame(() => {
      restorePageScrollInnerFrame = null
      window.scrollTo({
        left: lockedPageScrollPosition.left,
        top: lockedPageScrollPosition.top,
        behavior: 'auto',
      })
    })
  })
}

export function LargeDialogShell({
  children,
  ariaLabel,
  maxWidthClassName = 'max-w-[1320px]',
  maxHeightClassName = 'max-h-[92vh]',
  overlayClassName = 'z-[70] bg-slate-950/30',
  panelShadowClassName = 'shadow-slate-950/20',
  panelRadiusClassName = 'rounded-md',
  panelClassName,
  returnPageScrollPosition,
}: LargeDialogShellProps) {
  useEffect(() => {
    cancelPendingPageScrollRestore()
    if (pageScrollLockCount === 0) {
      lockedPageScrollPosition = returnPageScrollPosition ?? getPageScrollPosition()
      const style = document.documentElement.style
      previousDocumentOverflow = ['overflow-x', 'overflow-y'].map(name => ({
        name, value: style.getPropertyValue(name), priority: style.getPropertyPriority(name),
      }))
      // Lock the viewport only. Clipping body makes a wide report's overflow
      // disappear from the root scroll range and unmounts its virtual columns.
      style.overflow = 'hidden'
    }
    pageScrollLockCount += 1

    return () => {
      pageScrollLockCount = Math.max(0, pageScrollLockCount - 1)
      if (pageScrollLockCount === 0) {
        const style = document.documentElement.style
        style.removeProperty('overflow')
        for (const { name, value, priority } of previousDocumentOverflow) {
          if (value) style.setProperty(name, value, priority)
        }
        schedulePageScrollRestore()
      }
    }
  }, [returnPageScrollPosition])

  const shell = (
    <div className={cn('fixed inset-0 flex items-center justify-center overflow-hidden overscroll-contain px-4 backdrop-blur-[1px]', overlayClassName)}>
      <div
        data-modal-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
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

  return typeof document === 'undefined' ? shell : createPortal(shell, document.body)
}
