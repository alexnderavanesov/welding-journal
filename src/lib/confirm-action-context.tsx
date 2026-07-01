import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  ConfirmActionDialog,
  type ConfirmActionDialogTone,
} from '@/components/confirm-action-dialog'

export type ConfirmActionOptions = {
  title: string
  itemName?: ReactNode
  description?: ReactNode
  warning?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmActionDialogTone
}

export type ConfirmAction = (options: ConfirmActionOptions) => Promise<boolean>

type PendingConfirmAction = ConfirmActionOptions & {
  resolve: (confirmed: boolean) => void
}

const ConfirmActionContext = createContext<ConfirmAction | null>(null)

export function ConfirmActionProvider({ children }: { children: ReactNode }) {
  const [pendingAction, setPendingAction] = useState<PendingConfirmAction | null>(null)

  const confirmAction = useCallback<ConfirmAction>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPendingAction({ ...options, resolve })
      }),
    [],
  )

  const closePendingAction = useCallback((confirmed: boolean) => {
    setPendingAction((current) => {
      current?.resolve(confirmed)
      return null
    })
  }, [])

  const contextValue = useMemo(() => confirmAction, [confirmAction])

  return (
    <ConfirmActionContext.Provider value={contextValue}>
      {children}
      {pendingAction ? (
        <ConfirmActionDialog
          title={pendingAction.title}
          itemName={pendingAction.itemName}
          description={pendingAction.description}
          warning={pendingAction.warning}
          confirmLabel={pendingAction.confirmLabel}
          cancelLabel={pendingAction.cancelLabel}
          tone={pendingAction.tone}
          onClose={() => closePendingAction(false)}
          onConfirm={() => closePendingAction(true)}
        />
      ) : null}
    </ConfirmActionContext.Provider>
  )
}

export function useConfirmAction() {
  const confirmAction = useContext(ConfirmActionContext)
  if (!confirmAction) {
    throw new Error('useConfirmAction must be used inside ConfirmActionProvider')
  }
  return confirmAction
}
