import type { ReactNode } from 'react'

import { LargeDialogShell } from '@/components/large-dialog-shell'
import {
  WORKFLOW_DIALOG_HEIGHT_CLASS,
  WORKFLOW_DIALOG_OVERLAY_CLASS,
  WORKFLOW_DIALOG_SHADOW_CLASS,
  WORKFLOW_DIALOG_WIDTH_CLASS,
  WORKFLOW_MANAGER_DIALOG_HEIGHT_CLASS,
  WORKFLOW_MANAGER_DIALOG_OVERLAY_CLASS,
  WORKFLOW_MANAGER_DIALOG_WIDTH_CLASS,
} from '@/components/workflow-dialog-layout'
import type { PageScrollPosition } from '@/lib/page-scroll-position'
import { cn } from '@/lib/utils'

export function WorkflowDialogShell({
  children,
  variant = 'workflow',
  returnPageScrollPosition,
  elevated = false,
}: {
  children: ReactNode
  variant?: 'workflow' | 'manager'
  returnPageScrollPosition?: PageScrollPosition
  elevated?: boolean
}) {
  const manager = variant === 'manager'
  return (
    <LargeDialogShell
      maxWidthClassName={manager ? WORKFLOW_MANAGER_DIALOG_WIDTH_CLASS : WORKFLOW_DIALOG_WIDTH_CLASS}
      maxHeightClassName={manager ? WORKFLOW_MANAGER_DIALOG_HEIGHT_CLASS : WORKFLOW_DIALOG_HEIGHT_CLASS}
      overlayClassName={cn(
        manager ? WORKFLOW_MANAGER_DIALOG_OVERLAY_CLASS : WORKFLOW_DIALOG_OVERLAY_CLASS,
        elevated && 'z-[110]',
      )}
      panelShadowClassName={WORKFLOW_DIALOG_SHADOW_CLASS}
      panelClassName="overflow-hidden"
      returnPageScrollPosition={returnPageScrollPosition}
    >
      {children}
    </LargeDialogShell>
  )
}
